import { copyBuildingPlanData as copy } from '../model.js';
import { cleanPoint } from '../geometry.js';
import { SAME, along, lineFrame, pointAt } from './grid.js';
import { deriveBuildingPlanPieces } from './pieces.js';
import { pieceAt } from './face-plans.js';
import { edgeLength, splitEdge } from './cut-edges.js';
import { rejoinCut } from './cut-rejoin.js';
import { nameOf } from '../wall-children.js';
import { divideBeamsAtCut } from './beam-divisions.js';

export { rejoinCut };

const refuse = (code, message) => {
  throw Object.assign(new Error(message), { issues: [{ code, message }] });
};
const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const created = (cutId, primary) => ({
  result: { created: { type: 'editing_cut', id: cutId } },
  preferredRoomIds: primary.rooms.map((room) => room.id),
});
// The cut names the door or window it crosses (a beam across it divides, wall beams 2c).
const crossesOpening = (opening) =>
  refuse(
    'opening_crosses_cut',
    `This cut crosses ${nameOf(opening)}. Choose an opening edge or another position.`
  );

/** The subject's opening or beam that lies across the point (on its anchor row's line), if any. */
function openingAcross(primary, derived, subjectId, point) {
  for (const opening of primary.subjects.get(subjectId)?.openings || []) {
    // A beam across the cut divides with the wall (wall beams 2c); doors and windows refuse.
    if (opening.type === 'beam') continue;
    const anchor = primary.anchors.find((entry) => entry.faceId === opening.faceId);
    const line =
      anchor &&
      derived.lines.find(
        (entry) =>
          entry.roomId === anchor.roomId && entry.edges.some((edge) => edge.id === anchor.edgeId)
      );
    if (!line) continue;
    const start = line.edges.find((edge) => edge.id === anchor.edgeId).from + opening.from;
    const station = along(line.frame, point);
    if (station > start + SAME && station < start + opening.width - SAME) return opening;
  }
  return null;
}

/** Split a partition portion: the row keeps the first part, a new row takes the second. */
function splitPartition(primary, partition, operation, createId) {
  if (
    partition.path.length !== 2 ||
    (operation.edgeId && operation.edgeId !== partition.freeEdges[0])
  )
    refuse('ambiguous_cut', 'Choose one straight wall portion to split.');
  const frame = lineFrame(partition.path[0], partition.path[1]);
  const at = operation.offset;
  if (!Number.isFinite(at) || at <= SAME || at >= frame.length - SAME)
    refuse('invalid_cut', 'Choose an interior position on this wall portion.');
  const openings = primary.subjects.get(partition.subjectId)?.openings || [];
  const own = openings.filter((opening) => opening.faceId === partition.faceId);
  const crossing = own.find(
    (o) => o.type !== 'beam' && o.from < at - SAME && o.from + o.width > at + SAME
  );
  if (crossing) crossesOpening(crossing);
  const cutId = createId();
  const point = cleanPoint(pointAt(frame, at));
  const origin = partition.lineage?.editingOriginFaceId || partition.faceId;
  const lineage = { ...(partition.lineage || {}), editingOriginFaceId: origin };
  const next = {
    ...copy(partition),
    faceId: createId(),
    path: [{ id: createId(), ...point, editingCutId: cutId }, copy(partition.path[1])],
    freeEdges: [createId()],
    bindingIds: [null],
    lineage,
  };
  Object.assign(partition, {
    path: [partition.path[0], { id: createId(), ...point, editingCutId: cutId }],
    freeEdges: [createId()],
    bindingIds: [null],
    lineage,
  });
  for (const opening of own)
    if (opening.from >= at - SAME)
      Object.assign(opening, { faceId: next.faceId, from: opening.from - at });
  const subject = primary.subjects.get(partition.subjectId);
  if (subject) divideBeamsAtCut(subject, partition.faceId, next.faceId, at, createId);
  primary.partitions.splice(primary.partitions.indexOf(partition) + 1, 0, next);
  const room = primary.rooms.find((entry) => entry.id === partition.roomId);
  room.faceOrder?.splice(room.faceOrder.indexOf(partition.faceId) + 1, 0, next.faceId);
  return created(cutId, primary);
}

/**
 * `split_face` on the derived core (item 4, rules 1-4): the row's edge is cut `offset` metres
 * from the start of the row's stretch on it. Every room line of the piece there gets a vertex
 * with one cut ID (both rooms of a shared piece); at an automatic boundary the station becomes
 * the cut. A door or window across the point refuses. The write-back divides the subject (the
 * session asks the `on_split` questions).
 *
 * @returns {{result: Object, preferredRoomIds: string[]}}
 */
export function splitFace(primary, operation, { createId, specifications }) {
  const partition = primary.partitions.find((entry) => entry.faceId === operation.faceId);
  if (partition) return splitPartition(primary, partition, operation, createId);
  const anchors = primary.anchors.filter(
    (anchor) =>
      anchor.faceId === operation.faceId &&
      (!operation.edgeId || anchor.edgeId === operation.edgeId)
  );
  if (!anchors.length) throw new Error('The wall face no longer exists.');
  if (new Set(anchors.map((anchor) => anchor.edgeId)).size !== 1)
    refuse('ambiguous_cut', 'Choose one straight wall portion to split.');
  const room = primary.rooms.find((entry) => entry.id === anchors[0].roomId);
  const derived = deriveBuildingPlanPieces(primary, specifications);
  const line = derived.lines.find(
    (entry) => entry.roomId === room.id && entry.edges.some((edge) => edge.id === anchors[0].edgeId)
  );
  const edge = line.edges.find((entry) => entry.id === anchors[0].edgeId);
  const from = Math.min(...anchors.map((anchor) => anchor.from));
  const to = Math.max(...anchors.map((anchor) => anchor.to ?? edge.to - edge.from));
  const at = from + operation.offset;
  const point = pointAt(line.frame, edge.from + at);
  const cutId = createId();
  if (Number.isFinite(at) && (Math.abs(at - from) <= SAME || Math.abs(at - to) <= SAME)) {
    const station = room.vertices.find(
      (v) => gap(v, point) <= SAME && v.physicalBoundaryId && !v.editingCutId
    );
    if (station) {
      for (const target of primary.rooms)
        for (const vertex of target.vertices)
          if (vertex.physicalBoundaryId === station.physicalBoundaryId) vertex.editingCutId = cutId;
      return created(cutId, primary);
    }
  }
  if (!Number.isFinite(at) || at <= from + SAME || at >= to - SAME)
    refuse('invalid_cut', 'Choose an interior position on this wall portion.');
  const piece = pieceAt(derived, line, edge.from + at);
  if (!piece) refuse('invalid_cut', 'Choose an interior position on this wall portion.');
  const crossing = openingAcross(primary, derived, piece.subjectId, point);
  if (crossing) crossesOpening(crossing);
  let divisions = 0;
  for (const entry of piece.lines) {
    const target = primary.rooms.find((candidate) => candidate.id === entry.roomId);
    const own = derived.lines.find((l) => l.roomId === entry.roomId && l.index === entry.index);
    const station = along(own.frame, point);
    const vertex = target.vertices.find(
      (v) => gap(v, pointAt(own.frame, station)) <= SAME && !v.editingCutId
    );
    if (vertex) {
      if (vertex.physicalBoundaryId) vertex.editingCutId = cutId;
      continue;
    }
    const host = own.edges.find((e) => e.from + SAME < station && station < e.to - SAME);
    if (!host) continue;
    const roomEdge = target.edges.find((e) => e.id === host.id);
    if (station - host.from >= edgeLength(target, roomEdge) - SAME) continue;
    const id = createId();
    splitEdge(
      primary,
      target,
      host.id,
      station - host.from,
      { id, ...pointAt(own.frame, station), editingCutId: cutId },
      createId
    );
    divisions++;
  }
  if (!divisions)
    refuse(
      'invalid_cut',
      'This position is already a portion boundary. Choose an interior position.'
    );
  return created(cutId, primary);
}
