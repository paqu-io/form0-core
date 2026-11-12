import { equalValue } from '../model.js';
import { SAME, along, lineFrame, offset } from './grid.js';
import { deriveBuildingPlanPieces } from './pieces.js';
import { pieceAt } from './face-plans.js';
import { joinEdges } from './cut-edges.js';

const refuse = (code, message) => {
  throw Object.assign(new Error(message), { issues: [{ code, message }] });
};
const notAligned = () =>
  refuse('cut_not_aligned', 'Align the split portions on the same straight line before rejoining.');
const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const ANSWERS = ['overrides', 'providerOverrides', 'values', 'repeatable'];
const sameAnswers = (a, b) => ANSWERS.every((key) => equalValue(a?.[key] || {}, b?.[key] || {}));

/** Two runs continue each other: same direction, the second on the first's line. */
function collinear(first, second) {
  const a = lineFrame(first[0], first[1]);
  const b = lineFrame(second[0], second[1]);
  if (!a || !b || a.tangent.x * b.tangent.x + a.tangent.y * b.tangent.y <= 0) notAligned();
  if (Math.abs(offset(a, second[1])) > SAME) notAligned();
}

/**
 * Today's Rejoin checks (rule 5): the physical answers match, and each side's answers match the
 * side facing the same room (`facing`: the sign of a subject's side towards the cut's room).
 * Different rooms on either side (`adjacent` false) are a different adjacency.
 */
function compatible(a, b, facing, adjacent = true) {
  if (!a || !b) refuse('cut_physical_conflict', 'These pieces no longer share a boundary.');
  if (a === b) return;
  if (!sameAnswers(a, b))
    refuse(
      'cut_construction_conflict',
      'Resolve the physical answers and override intent before rejoining.'
    );
  const direction = facing(a) * facing(b);
  const sides = (a.sides || []).every((side) => {
    const other = (b.sides || []).find((entry) => entry.sign === side.sign * direction);
    return other && sameAnswers(side, other);
  });
  if (!adjacent || !sides)
    refuse(
      'cut_answer_conflict',
      'Rejoin requires matching room adjacency and compatible answers on both surfaces.'
    );
}

/** Partition portions meeting at the cut become one; the second's subject joins the first's. */
function rejoinPartitions(primary, roomId, cutId, createId) {
  const portions = primary.partitions.filter((entry) => entry.roomId === roomId);
  const before = portions.find((entry) => entry.path.at(-1).editingCutId === cutId);
  const after = portions.find((entry) => entry.path[0].editingCutId === cutId);
  if (!before || !after || before === after || gap(before.path.at(-1), after.path[0]) > SAME)
    notAligned();
  const [a, b] = [before, after].map((entry) => primary.subjects.get(entry.subjectId));
  compatible(a, b, () => 1);
  collinear([before.path[0], before.path.at(-1)], [after.path[0], after.path.at(-1)]);
  const length = gap(before.path[0], before.path.at(-1));
  for (const subject of primary.subjects.values())
    for (const opening of subject.openings || [])
      if (opening.faceId === after.faceId)
        Object.assign(opening, { faceId: before.faceId, from: opening.from + length });
  if (a !== b) {
    a.openings = [...(a.openings || []), ...(b.openings || [])];
    a.lineage = {
      ...(a.lineage || {}),
      mergedWallIds: [...(a.lineage?.mergedWallIds || []), b.id],
    };
    primary.subjects.delete(b.id);
  }
  Object.assign(before, {
    path: [before.path[0], after.path.at(-1)],
    freeEdges: [createId()],
    sides: [before.sides[0]],
    bindingIds: [null],
  });
  primary.partitions = primary.partitions.filter((entry) => entry !== after);
  const room = primary.rooms.find((entry) => entry.id === roomId);
  if (room.faceOrder) room.faceOrder = room.faceOrder.filter((id) => id !== after.faceId);
}

/**
 * `rejoin_cut` on the derived core (item 4, rule 5): an explicit cut, or an automatic boundary
 * by its ID, goes from every room and partition carrying it. The portions must continue each other
 * and have the same answers (today's codes); the pieces then join in the write-back.
 *
 * @returns {{result: Object, preferredRoomIds: string[]}}
 */
export function rejoinCut(primary, { cutId }, { createId, specifications }) {
  const matches = (v) => (v.editingCutId || v.physicalBoundaryId) === cutId;
  const targets = primary.rooms.filter((room) => room.vertices.some(matches));
  const free = primary.partitions.filter((p) => p.path.some((v) => v.editingCutId === cutId));
  if (!cutId || (!targets.length && !free.length))
    refuse('missing_cut', 'Choose an existing editing cut to rejoin.');
  for (const roomId of new Set(free.map((entry) => entry.roomId)))
    rejoinPartitions(primary, roomId, cutId, createId);

  const derived = deriveBuildingPlanPieces(primary, specifications);
  const joins = [];
  for (const room of targets) {
    const vertices = room.vertices.filter(matches);
    if (vertices.length !== 1) notAligned();
    const vertex = vertices[0];
    const into = room.edges.find((edge) => edge.endId === vertex.id);
    const out = room.edges.find((edge) => edge.startId === vertex.id);
    const point = (id) => room.vertices.find((v) => v.id === id);
    collinear([point(into.startId), vertex], [vertex, point(out.endId)]);
    const line = derived.lines.find(
      (entry) => entry.roomId === room.id && entry.edges.some((edge) => edge.id === into.id)
    );
    const station = along(line.frame, vertex);
    const [p, q] = [station - 2 * SAME, station + 2 * SAME].map((s) => pieceAt(derived, line, s));
    const rooms = (piece) =>
      piece &&
      piece.lines
        .map((entry) => entry.roomId)
        .sort()
        .join('|');
    const facing = (subject) =>
      primary.anchors.find((anchor) => anchor.faceId === subject.referenceFaceId)?.roomId ===
      room.id
        ? 1
        : -1;
    const [a, b] = [p, q].map((piece) => piece && primary.subjects.get(piece.subjectId));
    compatible(a, b, facing, rooms(p) === rooms(q));
    joins.push({ room, vertex, subjects: [a, b] });
  }
  for (const { room, vertex, subjects } of joins) {
    joinEdges(primary, room, vertex.id);
    // The cut was the separation today's Split recorded on both walls: it goes with the cut.
    for (const subject of subjects)
      if (subject.lineage?.explicitPhysicalSeparation) {
        const { explicitPhysicalSeparation: _, ...lineage } = subject.lineage;
        subject.lineage = lineage;
      }
  }
  return { result: {}, preferredRoomIds: primary.rooms.map((room) => room.id) };
}
