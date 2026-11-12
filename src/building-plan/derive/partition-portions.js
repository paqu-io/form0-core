import { cleanPoint } from '../geometry.js';
import { equalValue } from '../model.js';
import { SAME, lineFrame } from './grid.js';

const refuse = (code, message, details = {}) => {
  throw Object.assign(new Error(message), { issues: [{ code, message, ...details }] });
};
const gap = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const ANSWERS = ['overrides', 'providerOverrides', 'values', 'repeatable'];
const sameAnswers = (a, b) => ANSWERS.every((key) => equalValue(a?.[key] || {}, b?.[key] || {}));

/** The portion's checks, as today: a Split portion, not a return, moved parallel and square. */
function checkedDelta(partition, operation) {
  if (!partition.lineage?.editingOriginFaceId)
    refuse('invalid_partition_cut', 'Choose a partition portion created with Split.');
  if (partition.lineage.editingReturn)
    refuse('derived_partition_return', 'Move an adjacent partition portion to adjust this return.');
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
      'This edit removes a partition return containing an opening.',
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
 * part of the moved portion's wall; the write-back divides it, as today.
 */
export function movePartitionPortion(primary, partition, operation, { createId } = {}) {
  const delta = checkedDelta(partition, operation);
  const all = primary.rooms.map((room) => room.id);
  if (Math.hypot(delta.x, delta.y) <= SAME) return { result: {}, preferredRoomIds: all };
  partition.path = partition.path.map((point) =>
    cleanPoint({ ...point, x: point.x + delta.x, y: point.y + delta.y })
  );
  const origin = partition.lineage.editingOriginFaceId;
  const inRoom = primary.partitions.filter((entry) => entry.roomId === partition.roomId);
  const portions = inRoom.filter(
    (entry) => entry.lineage?.editingOriginFaceId === origin && !entry.lineage.editingReturn
  );
  const vertex = (id) =>
    portions
      .flatMap((entry) => entry.path.map((point) => ({ entry, point })))
      .find(({ point }) => point.id === id);
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
  return { result: {}, preferredRoomIds: all };
}
