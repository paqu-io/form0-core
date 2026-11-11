import { SAME, along, pointAt } from './grid.js';
import { moveRoomStretch } from './boundary-edits.js';
import { remapRoomSpans } from './span-remap.js';
import { deriveBuildingPlanPieces } from './pieces.js';
import {
  depth,
  endSituation,
  inward,
  junctionAllowance,
  pieceAt,
  subjectNear,
} from './face-plans.js';

const refuse = (code, message, subject) => {
  throw Object.assign(new Error(message), {
    issues: [{ code, message, ...(subject ? { subject } : {}) }],
  });
};
const dot = (a, b) => a.x * b.x + a.y * b.y;

/** The dragged stretch: the row's edge (or `interval` of it) as stations of its room line. */
function locateFace(primary, operation, lines) {
  if (primary.partitions.some((partition) => partition.faceId === operation.faceId))
    refuse('unsupported_face_edit', 'Resize the host wall of an internal partition directly.');
  const anchors = primary.anchors.filter(
    (anchor) =>
      anchor.faceId === operation.faceId &&
      (!operation.edgeId || anchor.edgeId === operation.edgeId)
  );
  if (!anchors.length) throw new Error('The wall face no longer exists.');
  const edgeIds = [...new Set(anchors.map((anchor) => anchor.edgeId))];
  if (edgeIds.length !== 1)
    refuse('ambiguous_face_edit', 'Choose the specific straight room edge to edit.', {
      type: 'room_face',
      id: operation.faceId,
    });
  const roomId = anchors[0].roomId;
  const line = lines.find(
    (entry) => entry.roomId === roomId && entry.edges.some((edge) => edge.id === edgeIds[0])
  );
  const edge = line.edges.find((entry) => entry.id === edgeIds[0]);
  const length = edge.to - edge.from;
  const interval = operation.interval || [
    Math.min(...anchors.map((anchor) => anchor.from)),
    Math.max(...anchors.map((anchor) => anchor.to ?? length)),
  ];
  if (
    !Array.isArray(interval) ||
    !interval.every(Number.isFinite) ||
    interval[0] < -SAME ||
    interval[1] > length + SAME ||
    interval[1] - interval[0] <= SAME
  )
    refuse('invalid_dimension', 'The edited extent is outside its room edge.');
  return {
    roomId,
    line,
    edgeId: edge.id,
    from: edge.from + Math.max(0, interval[0]),
    to: edge.from + Math.min(length, interval[1]),
  };
}

/** Neighbours sharing the dragged stretch follow it: their facing stretch moves too. */
function followers(derived, lines, stretch) {
  const result = [];
  for (const piece of derived.pieces) {
    if (piece.partition || piece.lines.length < 2) continue;
    const own = piece.lines.find(
      (entry) => entry.roomId === stretch.roomId && entry.index === stretch.line.index
    );
    const other = piece.lines.find((entry) => entry !== own);
    if (!own || !other) continue;
    const from = Math.max(own.from, stretch.from);
    const to = Math.min(own.to, stretch.to);
    if (to - from <= SAME) continue;
    const line = lines.find(
      (entry) => entry.roomId === other.roomId && entry.index === other.index
    );
    const [a, b] = [from, to]
      .map((station) => along(line.frame, pointAt(stretch.line.frame, station)))
      .sort((x, y) => x - y);
    result.push({ roomId: line.roomId, line, from: a, to: b, width: piece.width });
  }
  return result;
}

/** The physical point of a run end. */
const endPoint = (run, atEnd) => pointAt(run.line.frame, atEnd ? run.to : run.from);
const samePlace = (p, q, width) => Math.hypot(p.x - q.x, p.y - q.y) <= width + SAME * 4;

/**
 * Plan one end of a moved stretch: slide its corner, or place a jog where the room's clear space
 * stays out of the partner room's wall material (the partner being the room across the moved
 * wall). F1: a new jog copies the adjacent part with its own exposure, else the moved part.
 */
function planEnd(derived, run, atEnd, delta) {
  const { line, situation } = run.ends[atEnd ? 1 : 0];
  const station = atEnd ? run.to : run.from;
  const sign = atEnd ? 1 : -1;
  const moved = dot(delta, inward(line));
  if (situation.kind === 'slide') return { type: 'slide' };
  const relative = situation.kind === 'shift' ? moved - depth(line, situation.continuation) : moved;
  const partner = run.ends[atEnd ? 1 : 0].partner;
  const allowance = relative > SAME ? junctionAllowance(derived, line, partner, run.width ?? 0) : 0;
  if (situation.kind === 'shift') {
    if (Math.abs(relative) > SAME) return { type: 'shift', station: station + sign * allowance };
    // The moved line runs on again on the continuation: what moved with it there continues it.
    const continuation = situation.continuation;
    const at = atEnd ? 0 : continuation.frame.length;
    return { type: 'shift', station: null, joinAnchor: subjectNear(continuation, at, at + sign) };
  }
  const target = station + sign * allowance;
  // A jog would pass the line's corner: the whole remainder of the line moves instead.
  if (atEnd ? target >= line.frame.length - SAME : target <= SAME) return { type: 'slide' };
  const jogExposure = partner?.situation.kind === 'straight' ? 'interior' : 'exterior';
  const parts = [
    {
      anchor: subjectNear(line, station, station - sign),
      exposure: run.partnerRun
        ? 'interior'
        : pieceAt(derived, line, station - sign * SAME * 2)?.exposure,
    },
    {
      anchor: subjectNear(line, target, target + sign),
      exposure: pieceAt(derived, line, target + sign * SAME * 2)?.exposure,
    },
  ];
  const chosen = parts.find((part) => part.anchor && part.exposure === jogExposure) || parts[0];
  return { type: 'jog', station: target, jogAnchor: chosen.anchor };
}

/**
 * Anchor the edges the edit created. F2: a new jog lying against another room's existing wall
 * has no wall of its own there (that wall continues over the contact, and what is left of the jog
 * in its corner is a cap); otherwise F1, the jog copies the part chosen for it.
 */
function anchorNewEdges(primary, additions, specifications, createId) {
  if (!additions.length) return;
  const after = deriveBuildingPlanPieces(primary, specifications);
  const meetsExistingWall = ({ room, edgeId }) => {
    const line = after.lines.find(
      (entry) => entry.roomId === room.id && entry.edges.some((edge) => edge.id === edgeId)
    );
    const edge = line.edges.find((entry) => entry.id === edgeId);
    return after.pieces.some(
      (piece) =>
        piece.subjectId &&
        piece.lines.length > 1 &&
        piece.lines.some(
          (entry) =>
            entry.roomId === room.id &&
            entry.index === line.index &&
            Math.min(entry.to, edge.to) - Math.max(entry.from, edge.from) > SAME
        )
    );
  };
  for (const addition of additions) {
    if (addition.jog && meetsExistingWall(addition)) continue;
    primary.anchors.push({
      subjectId: addition.anchor.subjectId,
      faceId: createId(),
      roomId: addition.room.id,
      edgeId: addition.edgeId,
      from: 0,
      to: null,
      bindingId: null,
      lineage: { jogOriginFaceId: addition.anchor.faceId },
    });
  }
}

/**
 * `resize_face` on the derived core: the row's edge (or `interval`) moves `distance` outward from
 * its room; rooms sharing it follow; each end slides at a corner or makes a jog.
 *
 * @returns {{result: Object, preferredRoomIds: string[]}}
 */
export function resizeFace(primary, operation, { createId, specifications }) {
  if (!Number.isFinite(operation.distance))
    refuse('invalid_dimension', 'A finite face displacement is required.');
  const derived = deriveBuildingPlanPieces(primary, specifications);
  const stretch = locateFace(primary, operation, derived.lines);
  const all = primary.rooms.map((room) => room.id);
  if (Math.abs(operation.distance) <= SAME) return { result: {}, preferredRoomIds: all };
  const out = { x: -inward(stretch.line).x, y: -inward(stretch.line).y };
  const delta = { x: out.x * operation.distance, y: out.y * operation.distance };

  const runs = [{ ...stretch, preferMoved: [stretch.edgeId] }];
  for (const follower of followers(derived, derived.lines, stretch)) {
    const run = { ...follower, partnerRun: runs[0] };
    runs.push(run);
    runs[0].partnerRun = run;
    runs[0].width = follower.width;
  }
  for (const run of runs)
    run.ends = [false, true].map((atEnd) => ({
      atEnd,
      line: run.line,
      point: endPoint(run, atEnd),
      situation: endSituation(
        derived.lines,
        derived.caps,
        run.line,
        atEnd ? run.to : run.from,
        atEnd
      ),
    }));
  // Each end's partner: the end of the other run at the same place across the wall.
  for (const run of runs)
    for (const end of run.ends)
      end.partner =
        run.partnerRun?.ends?.find((other) => samePlace(other.point, end.point, run.width)) || null;

  const additions = [];
  for (const run of runs) {
    const room = primary.rooms.find((entry) => entry.id === run.roomId);
    const ends = [planEnd(derived, run, false, delta), planEnd(derived, run, true, delta)];
    const edited = moveRoomStretch(
      room,
      { line: run.line, from: run.from, to: run.to, delta, ends, preferMoved: run.preferMoved },
      createId
    );
    remapRoomSpans(primary, room, edited.edges, edited.lengths, createId);
    for (const [edgeId, entry] of edited.edges) {
      const anchor =
        (entry.jog && !entry.replaces && ends[entry.end]?.jogAnchor) ||
        (entry.extension && ends[entry.extension === 'end' ? 1 : 0].joinAnchor);
      if (anchor) additions.push({ room, edgeId, anchor, jog: entry.jog });
    }
  }
  anchorNewEdges(primary, additions, specifications, createId);
  const edited = new Set(runs.map((run) => run.roomId));
  return { result: {}, preferredRoomIds: all.filter((id) => !edited.has(id)) };
}
