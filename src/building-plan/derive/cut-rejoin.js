import { equalValue, own } from '../model.js';
import { mergeWallAnswers } from '../wall-merge.js';
import { SAME, along, lineFrame, offset } from './grid.js';
import { deriveBuildingPlanPieces } from './pieces.js';
import { pieceAt } from './face-plans.js';
import { joinEdges } from './cut-edges.js';
import { prepareJoinChoice } from './value-choices.js';
import { carrySharedChoices } from './shared-choices.js';
import { mergeMeetingBeams } from './beam-divisions.js';

const beamIds = (subject) =>
  new Set(
    (subject?.openings || []).filter((entry) => entry.type === 'beam').map((entry) => entry.id)
  );

const refuse = (code, message) => {
  throw Object.assign(new Error(message), { issues: [{ code, message }] });
};
const notAligned = () =>
  refuse('cut_not_aligned', 'Align the split portions on the same straight line before rejoining.');
const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const millimetres = (metres) => (metres > 0 ? `${Math.round(metres * 1000)} mm` : 'unknown');
const thicknessOf = (subject) =>
  own(subject.overrides, 'wall_thickness')
    ? subject.overrides.wall_thickness
    : (subject.properties?.wall_thickness ?? null);
/** Both hold custom records and they differ (one holding none keeps the other's, as a join). */
const recordsDiffer = (a, b) =>
  [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].some(
    (key) => a?.[key]?.length && b?.[key]?.length && !equalValue(a[key], b[key])
  );

/** Two runs continue each other: same direction, the second on the first's line. */
function collinear(first, second) {
  const a = lineFrame(first[0], first[1]);
  const b = lineFrame(second[0], second[1]);
  if (!a || !b || a.tangent.x * b.tangent.x + a.tangent.y * b.tangent.y <= 0) notAligned();
  if (Math.abs(offset(a, second[1])) > SAME) notAligned();
}

/**
 * Rejoin checks (rule 5, revised 2026-11-16): the portions must face the same rooms (`adjacent`).
 * Differing values are asked by one choice (`rejoinSubjects`) except what no choice can settle:
 * a different thickness (geometry; item 5) and different custom records, which refuse in plain
 * words, and different explicit providers, which refuse as before. `facing`: the sign of a
 * subject's side towards the cut's room.
 */
function compatible(a, b, facing, adjacent = true) {
  if (!a || !b) refuse('cut_physical_conflict', 'These pieces no longer share a boundary.');
  if (a === b) return;
  if (!adjacent)
    refuse(
      'cut_answer_conflict',
      'Rejoin requires the same rooms on both sides of the two portions.'
    );
  const names = `${a.autoLabel || 'This portion'} and ${b.autoLabel || 'the next portion'}`;
  const [x, y] = [a, b].map(thicknessOf);
  if (!equalValue(x, y))
    refuse(
      'cut_construction_conflict',
      `${names} have different thicknesses (${millimetres(x)} and ${millimetres(y)}). Set the same thickness on both, then rejoin.`
    );
  const direction = facing(a) * facing(b);
  const sideRecords = (a.sides || []).some((side) =>
    recordsDiffer(
      side.repeatable,
      (b.sides || []).find((entry) => entry.sign === side.sign * direction)?.repeatable
    )
  );
  if (recordsDiffer(a.repeatable, b.repeatable) || sideRecords)
    refuse(
      'cut_construction_conflict',
      `${names} have different custom records. Make them the same on both, then rejoin.`
    );
  if (!equalValue(a.providerOverrides || {}, b.providerOverrides || {}))
    refuse(
      'cut_construction_conflict',
      'Resolve the physical answers and override intent before rejoining.'
    );
}

/**
 * Decision I6: Rejoin gives back the wall the Split divided. When one subject was divided from the
 * other (`dividedFromWallId` or `splitFromWallId`), that other survives; null leaves the choice
 * to the write-back's join rule (W7).
 */
function divisionSurvivor(a, b) {
  const from = (x, y) => [x.lineage?.dividedFromWallId, x.lineage?.splitFromWallId].includes(y.id);
  if (from(b, a)) return [a, b];
  if (from(a, b)) return [b, a];
  return null;
}

/**
 * `other` joins `survivor`: values that differ become one choice for the session (option a, as a
 * rejoin), every other answer merges; rows, paths and openings move.
 */
function absorbDivision(primary, survivor, other, facing) {
  const direction = (subject) => (subject === survivor ? 1 : facing(survivor) * facing(subject));
  const members = [survivor, other].map((subject) => ({
    subject,
    roomId: null,
    label: subject.autoLabel ?? null,
  }));
  const choice = prepareJoinChoice(survivor, members, direction, 'rejoin');
  if (choice) (primary.valueChoices ||= []).push(choice);
  const carry = carrySharedChoices(survivor, other);
  mergeWallAnswers(survivor, other, direction(other));
  carry();
  for (const entry of [...primary.anchors, ...primary.partitions])
    if (entry.subjectId === other.id) entry.subjectId = survivor.id;
  survivor.openings = [...(survivor.openings || []), ...(other.openings || [])];
  survivor.lineage = {
    ...(survivor.lineage || {}),
    mergedWallIds: [...(survivor.lineage?.mergedWallIds || []), other.id],
  };
  primary.subjects.delete(other.id);
}

/** Partition portions meeting at the cut become one subject (I6, else the first's). */
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
  const pair = a !== b ? divisionSurvivor(a, b) || [a, b] : [a, a];
  const keepIds = beamIds(pair[0]);
  if (a !== b) absorbDivision(primary, ...pair, () => 1);
  Object.assign(before, {
    path: [before.path[0], after.path.at(-1)],
    freeEdges: [createId()],
    sides: [before.sides[0]],
    bindingIds: [null],
  });
  // The beams the Split divided are one again when they meet and match (wall beams 2c).
  mergeMeetingBeams(primary, pair[0], keepIds);
  primary.partitions = primary.partitions.filter((entry) => entry !== after);
  const room = primary.rooms.find((entry) => entry.id === roomId);
  if (room.faceOrder) room.faceOrder = room.faceOrder.filter((id) => id !== after.faceId);
}

/**
 * `rejoin_cut` on the derived core (item 4, rule 5): an explicit cut, or an automatic boundary
 * by its ID, goes from every room and partition carrying it. The portions must continue each other
 * and face the same rooms; their differing values are asked once (2026-11-16). The wall the Split
 * divided survives (I6); other pieces join in the write-back, which asks the same way.
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
    joins.push({ room, vertex, subjects: [a, b], facing });
  }
  const merges = [];
  for (const { subjects, facing } of joins) {
    const pair = subjects[0] !== subjects[1] && divisionSurvivor(...subjects);
    const survivor = pair ? pair[0] : subjects[0];
    merges.push({ survivor, keepIds: beamIds(survivor) });
    if (pair && primary.subjects.has(pair[1].id)) absorbDivision(primary, ...pair, facing);
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
  // The beams the Split divided are one again when they meet and match (wall beams 2c).
  for (const { survivor, keepIds } of merges)
    if (survivor && primary.subjects.has(survivor.id))
      mergeMeetingBeams(primary, survivor, keepIds);
  return { result: {}, preferredRoomIds: primary.rooms.map((room) => room.id) };
}
