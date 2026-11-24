import { cleanPoint } from '../geometry.js';
import { equalValue } from '../model.js';
import { SAME, lineFrame } from './grid.js';
import { resolutionFloor, resolveWallThickness } from './thickness.js';
import { nameOf } from '../wall-children.js';

const refuse = (code, message, details = {}) => {
  throw Object.assign(new Error(message), { issues: [{ code, message, ...details }] });
};
const gap = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const ANSWERS = ['overrides', 'providerOverrides', 'values', 'repeatable'];
const sameAnswers = (a, b) => ANSWERS.every((key) => equalValue(a?.[key] || {}, b?.[key] || {}));

/** The portion's checks, as today: a Split portion moved parallel and square (a return: below). */
function checkedDelta(partition, operation) {
  if (!partition.lineage?.editingOriginFaceId)
    refuse('invalid_partition_cut', 'Choose a partition portion created with Split.');
  if (!Array.isArray(operation.vertices) || operation.vertices.length !== 2)
    refuse('invalid_partition_edit', 'Choose one straight partition portion to move.');
  const [p, q] = partition.path;
  const delta = { x: operation.vertices[0].x - p.x, y: operation.vertices[0].y - p.y };
  if (gap({ x: q.x + delta.x, y: q.y + delta.y }, operation.vertices[1]) > SAME)
    refuse(
      'partition_alignment',
      'Keep this split portion parallel while moving it. Rejoin it to reshape the whole partition.'
    );
  const frame = lineFrame(p, q);
  if (Math.abs(frame.tangent.x * delta.x + frame.tangent.y * delta.y) > SAME)
    refuse(
      'partition_alignment',
      'Move this split portion perpendicular to its wall. Rejoin it to move or reshape the whole partition.'
    );
  return delta;
}

/** A return that would close: it goes, unless it hosts an opening or has answers of its own. */
function closeReturn(primary, entry, neighbour) {
  const subject = primary.subjects.get(entry.subjectId);
  const openings = (subject?.openings || []).filter((o) => o.faceId === entry.faceId);
  if (openings.length)
    refuse(
      'opening_crosses_edit_boundary',
      `This edit removes a partition return containing ${nameOf(openings[0])}.`,
      {
        subject: { type: openings[0].type, id: openings[0].id },
        openingIds: openings.map((opening) => opening.id),
      }
    );
  const source = primary.subjects.get(neighbour.subjectId);
  if (subject !== source && !sameAnswers(subject, source))
    refuse(
      'partition_return_answers',
      'This return has distinct answers. Resolve them before straightening the partition.'
    );
  primary.partitions = primary.partitions.filter((other) => other !== entry);
  const room = primary.rooms.find((r) => r.id === entry.roomId);
  if (room.faceOrder) room.faceOrder = room.faceOrder.filter((id) => id !== entry.faceId);
  const shared =
    primary.partitions.some((other) => other.subjectId === entry.subjectId) ||
    primary.anchors.some((anchor) => anchor.subjectId === entry.subjectId);
  if (!shared) primary.subjects.delete(entry.subjectId);
}

/**
 * A moved Split portion of a partition (rule 14): it moves square to itself, and at each cut its
 * neighbouring portion stays connected through a return, a partition row from the earlier
 * portion's end to the later one's start that carries the cut at both ends (today's
 * `editingReturn`). A return already there follows; one that closes goes. The return starts as
 * part of the moved portion's wall; the write-back divides it, as today. A free wall is drawn by
 * its centreline, so its return stands centred on the split point whichever way the portion moves
 * (4a-4, 2026-11-20), not on one side of it as a room wall's does: the portions' ends at it lie on
 * its far face, half the wall's width along from the split point. Nothing marks it, every square
 * return of a free wall is taken as centred (a return made before 4a-4 shifts by half the width on
 * the portion's next move; records aren't launched). So an `update_wall` on such a portion sends
 * its stored face moved, as the canvas controller does, not the face as split.
 */
export function movePartitionPortion(
  primary,
  partition,
  operation,
  { createId, specifications } = {}
) {
  if (partition.lineage?.editingOriginFaceId && partition.lineage.editingReturn)
    return moveReturn(primary, partition, operation);
  const delta = checkedDelta(partition, operation);
  const all = primary.rooms.map((room) => room.id);
  if (Math.hypot(delta.x, delta.y) <= SAME) return { result: {}, preferredRoomIds: all };
  const origin = partition.lineage.editingOriginFaceId;
  const inRoom = primary.partitions.filter((entry) => entry.roomId === partition.roomId);
  const portions = inRoom.filter(
    (entry) => entry.lineage?.editingOriginFaceId === origin && !entry.lineage.editingReturn
  );
  const vertex = (id) =>
    portions
      .flatMap((entry) => entry.path.map((point) => ({ entry, point })))
      .find(({ point }) => point.id === id);
  // A return stands centred on its split point (4a-4): back onto the split point first.
  const half = halfWidth(primary, partition, specifications);
  const returnAt = (cutId) =>
    primary.partitions.find(
      (entry) => entry.roomId === partition.roomId && entry.lineage?.editingReturn?.cutId === cutId
    );
  for (const point of partition.path) {
    const existing = point.editingCutId && returnAt(point.editingCutId);
    if (existing && half > 0) centre(existing, vertex, -half);
  }
  partition.path = partition.path.map((point) =>
    cleanPoint({ ...point, x: point.x + delta.x, y: point.y + delta.y })
  );
  for (const point of partition.path) {
    const cutId = point.editingCutId;
    if (!cutId) continue;
    const existing = inRoom.find((entry) => entry.lineage?.editingReturn?.cutId === cutId);
    if (existing) {
      const { startVertexId, endVertexId } = existing.lineage.editingReturn;
      const [start, end] = [vertex(startVertexId), vertex(endVertexId)];
      if (!start || !end)
        refuse(
          'partition_return_cut',
          'Rejoin the explicit cuts on this return before moving its neighbouring portions.'
        );
      if (gap(start.point, end.point) <= SAME) {
        closeReturn(primary, existing, start.entry === partition ? end.entry : start.entry);
        continue;
      }
      existing.path = [start.point, end.point].map((p, index) =>
        cleanPoint({ ...existing.path[index], x: p.x, y: p.y })
      );
      continue;
    }
    const earlier = portions.find((entry) => entry.path.at(-1).editingCutId === cutId);
    const later = portions.find((entry) => entry.path[0].editingCutId === cutId);
    if (!earlier || !later || earlier === later) continue;
    const [from, to] = [earlier.path.at(-1), later.path[0]];
    if (gap(from, to) <= SAME) continue;
    const faceId = createId();
    primary.partitions.push({
      roomId: partition.roomId,
      faceId,
      subjectId: partition.subjectId,
      path: [from, to].map((p) => ({ id: createId(), x: p.x, y: p.y, editingCutId: cutId })),
      freeEdges: [createId()],
      sides: [1],
      bindingIds: [null],
      lineage: {
        editingOriginFaceId: origin,
        editingReturn: { cutId, startVertexId: from.id, endVertexId: to.id },
      },
    });
    primary.rooms.find((room) => room.id === partition.roomId).faceOrder?.push(faceId);
  }
  for (const point of partition.path) {
    const kept = point.editingCutId && returnAt(point.editingCutId);
    if (kept && half > 0) centre(kept, vertex, half);
  }
  return { result: {}, preferredRoomIds: all };
}

/** Half the partition's resolved width (its last width when unknown), in metres. */
export function halfWidth(primary, partition, specifications) {
  const subject = primary.subjects.get(partition.subjectId) || null;
  const resolved = specifications
    ? resolveWallThickness(resolutionFloor(primary), specifications, subject, [
        partition.roomId,
        partition.roomId,
      ])
    : {};
  const width = !resolved.conflict && resolved.value > 0 ? resolved.value : subject?.lastWidth;
  return width > 0 ? width / 2 : 0;
}

/**
 * Moves a return and the portions' ends at it by `amount` along the portions, towards its normal:
 * with half the width, from its split point to where its centreline is on it (its face then half
 * the width along the wall); with minus that, back. Only for a return square to the two portions
 * it joins (within a portion move's tolerance), which lie parallel; false otherwise.
 */
function centre(entry, vertex, amount) {
  const { startVertexId, endVertexId } = entry.lineage.editingReturn;
  const [start, end] = [vertex(startVertexId), vertex(endVertexId)];
  const own = lineFrame(entry.path[0], entry.path.at(-1));
  const along = (portion) => lineFrame(portion.path[0], portion.path.at(-1));
  if (!start || !end || !own) return false;
  const [a, b] = [along(start.entry), along(end.entry)];
  const cross = (u, v) => u.x * v.y - u.y * v.x;
  const dot = (u, v) => u.x * v.x + u.y * v.y;
  if (!a || !b || Math.abs(cross(a.tangent, b.tangent)) > 1e-4) return false;
  // Square to them within the move's own tolerance (a portion moves square within `SAME`).
  const span = {
    x: entry.path.at(-1).x - entry.path[0].x,
    y: entry.path.at(-1).y - entry.path[0].y,
  };
  if (Math.abs(dot(a.tangent, span)) > 2 * SAME) return false;
  // Along the portions exactly, so their ends stay on their lines.
  const step = (Math.sign(dot(own.normal, a.tangent)) || 1) * amount;
  const shift = (point) =>
    Object.assign(
      point,
      cleanPoint({ ...point, x: point.x + a.tangent.x * step, y: point.y + a.tangent.y * step })
    );
  [start.point, end.point, ...entry.path].forEach(shift);
  return true;
}

/**
 * A return moved (2026-11-22): parallel to itself, by the part of the move across it; its ends
 * slide along the portions it joins, which lengthen or shorten and keep their direction, as a
 * room wall's jog does. Refused when a portion would vanish or turn over, or runs nearly along
 * the return (its end would run off). The stored paths are faces on one side of the wall, all at
 * the same distance from the centrelines, so moving the faces moves the centrelines alike.
 */
function moveReturn(primary, partition, operation) {
  const all = primary.rooms.map((room) => room.id);
  if (!Array.isArray(operation.vertices) || operation.vertices.length !== 2)
    refuse('invalid_partition_edit', 'Choose one straight partition portion to move.');
  const [p, q] = partition.path;
  const delta = { x: operation.vertices[0].x - p.x, y: operation.vertices[0].y - p.y };
  if (gap({ x: q.x + delta.x, y: q.y + delta.y }, operation.vertices[1]) > SAME)
    refuse('partition_alignment', 'Keep this return parallel while moving it.');
  const frame = lineFrame(p, q);
  const across = frame ? frame.normal.x * delta.x + frame.normal.y * delta.y : 0;
  if (Math.abs(across) <= SAME) return { result: {}, preferredRoomIds: all };
  const { startVertexId, endVertexId } = partition.lineage.editingReturn;
  const origin = partition.lineage.editingOriginFaceId;
  const portions = primary.partitions.filter(
    (entry) =>
      entry.roomId === partition.roomId &&
      entry.lineage?.editingOriginFaceId === origin &&
      !entry.lineage.editingReturn
  );
  const earlier = portions.find((entry) => entry.path.at(-1).id === startVertexId);
  const later = portions.find((entry) => entry.path[0].id === endVertexId);
  if (!earlier || !later)
    refuse(
      'partition_return_cut',
      'Rejoin the explicit cuts on this return before moving its neighbouring portions.'
    );
  // Where a portion's line meets the return's line moved `across` along its normal.
  const line = { x: p.x + frame.normal.x * across, y: p.y + frame.normal.y * across };
  const slide = (far, near) => {
    const run = { x: near.x - far.x, y: near.y - far.y };
    const length = Math.hypot(run.x, run.y);
    const facing = (frame.normal.x * run.x + frame.normal.y * run.y) / (length || 1);
    if (!length || Math.abs(facing) < 0.05)
      refuse(
        'partition_return_parallel',
        'A portion next to this return runs nearly along it. Move that portion instead.'
      );
    const t =
      (frame.normal.x * (line.x - far.x) + frame.normal.y * (line.y - far.y)) /
      (frame.normal.x * run.x + frame.normal.y * run.y);
    if (t * length <= SAME)
      refuse(
        'partition_return_collapse',
        'This would shorten a portion next to the return to nothing. Move the return less far.'
      );
    return { x: far.x + run.x * t, y: far.y + run.y * t };
  };
  const start = slide(earlier.path.at(-2), earlier.path.at(-1));
  const end = slide(later.path[1], later.path[0]);
  const place = (point, to) => Object.assign(point, cleanPoint({ ...point, ...to }));
  place(earlier.path.at(-1), start);
  place(partition.path[0], start);
  place(later.path[0], end);
  place(partition.path[1], end);
  return { result: {}, preferredRoomIds: all };
}
