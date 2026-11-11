import { SAME, along, pointAt } from './grid.js';
import { moveRoomStretch } from './boundary-edits.js';
import { remapRoomSpans } from './span-remap.js';
import { deriveBuildingPlanPieces } from './pieces.js';
import { anchorAt } from './line-spans.js';
import { resolutionFloor } from './thickness.js';
import { explicitContactWidths, seatDistance, seatJogStation } from './face-contacts.js';
import { keepWallWithStationaryRoom, sharedWallMode, widenPlan } from './shared-wall-drag.js';
import {
  depth,
  endSituation,
  followers,
  inward,
  junctionAllowance,
  locateFace,
  pieceAt,
  subjectNear,
} from './face-plans.js';

const refuse = (code, message, subject) => {
  throw Object.assign(new Error(message), {
    issues: [{ code, message, ...(subject ? { subject } : {}) }],
  });
};
const dot = (a, b) => a.x * b.x + a.y * b.y;

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
  const jogExposure = partner?.situation.kind === 'straight' ? 'interior' : 'exterior';
  const moving = {
    anchor: subjectNear(line, station, station - sign),
    exposure: run.partnerRun
      ? 'interior'
      : pieceAt(derived, line, station - sign * SAME * 2)?.exposure,
  };
  // F1: a new jog copies the adjacent part with its exposure, else the moved part.
  const choose = (staying) =>
    [moving, staying].find((part) => part.anchor && part.exposure === jogExposure)?.anchor ||
    moving.anchor;
  if (situation.kind === 'shift') {
    const continuation = situation.continuation;
    const at = atEnd ? 0 : continuation.frame.length;
    const staying = {
      anchor: subjectNear(continuation, at, at + sign),
      exposure: pieceAt(derived, continuation, at + sign * SAME * 2)?.exposure,
    };
    // The moved line runs on again on the continuation: what moved with it there continues it.
    if (Math.abs(relative) <= SAME)
      return { type: 'shift', station: null, joinAnchor: staying.anchor };
    // The old jog's own wall stays with it; a stretch that was another wall's contact does not.
    const keep = situation.jog.edges
      .filter((edge) => {
        const piece = pieceAt(derived, situation.jog, (edge.from + edge.to) / 2);
        return piece?.subjectId && piece.exposure === 'exterior';
      })
      .map((edge) => edge.id);
    return {
      type: 'shift',
      station: station + sign * allowance,
      keep,
      jogAnchor: choose(staying),
    };
  }
  const target = station + sign * allowance;
  // A jog would pass the line's corner: the whole remainder of the line moves instead.
  if (atEnd ? target >= line.frame.length - SAME : target <= SAME) return { type: 'slide' };
  const staying = {
    anchor: subjectNear(line, target, target + sign),
    exposure: pieceAt(derived, line, target + sign * SAME * 2)?.exposure,
  };
  return { type: 'jog', station: target, jogAnchor: choose(staying) };
}

/**
 * Anchor the edges the edit created. F2: a jog lying against another room's existing wall has no
 * wall of its own there, whether the edit created it or placed it again (that wall continues over
 * the contact, and what is left of the jog in its corner is a cap); otherwise F1, a new jog copies
 * the part chosen for it, and a placed jog keeps its own wall.
 */
function anchorNewEdges(primary, additions, specifications, createId) {
  if (!additions.length) return;
  const after = deriveBuildingPlanPieces(primary, specifications);
  const lineOf = (roomId, index) =>
    after.lines.find((entry) => entry.roomId === roomId && entry.index === index);
  const meetsExistingWall = ({ room, edgeId }) => {
    const line = after.lines.find(
      (entry) => entry.roomId === room.id && entry.edges.some((edge) => edge.id === edgeId)
    );
    const edge = line.edges.find((entry) => entry.id === edgeId);
    return after.pieces.some((piece) => {
      const own = piece.lines.find(
        (entry) =>
          entry.roomId === room.id &&
          entry.index === line.index &&
          Math.min(entry.to, edge.to) - Math.max(entry.from, edge.from) > SAME
      );
      const other = own && piece.lines.find((entry) => entry !== own);
      return other && anchorAt(lineOf(other.roomId, other.index), other.from, other.to);
    });
  };
  for (const addition of additions) {
    if (addition.jog && meetsExistingWall(addition)) {
      primary.anchors = primary.anchors.filter(
        (anchor) => !(anchor.roomId === addition.room.id && anchor.edgeId === addition.edgeId)
      );
      continue;
    }
    if (!addition.anchor) continue;
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
export function resizeFace(primary, operation, { createId, specifications, editingPolicy }) {
  if (!Number.isFinite(operation.distance))
    refuse('invalid_dimension', 'A finite face displacement is required.');
  const derived = deriveBuildingPlanPieces(primary, specifications);
  const stretch = locateFace(primary, operation, derived.lines);
  const all = primary.rooms.map((room) => room.id);
  if (Math.abs(operation.distance) <= SAME) return { result: {}, preferredRoomIds: all };

  const floor = resolutionFloor(primary);
  const runs = [{ ...stretch, preferMoved: [stretch.edgeId] }];
  const sharing = followers(derived, derived.lines, stretch);
  // sharedWallDrag: towards the neighbour (or `move_wall`) the whole wall moves; away from it
  // `widen` keeps the neighbour, widens the wall, holds at the limit, then detaches.
  const plan =
    sharing.length === 1 &&
    operation.distance < 0 &&
    sharedWallMode(operation, editingPolicy) === 'widen'
      ? widenPlan(primary, floor, specifications, {
          subjectId: sharing[0].subjectId,
          roomIds: [stretch.roomId, sharing[0].roomId],
          width: sharing[0].width,
          distance: operation.distance,
        })
      : { kind: 'move', distance: operation.distance };
  if (Math.abs(plan.distance) <= SAME) return { result: {}, preferredRoomIds: all };
  if (plan.kind === 'detach')
    keepWallWithStationaryRoom(primary, sharing[0].subjectId, stretch.roomId, sharing[0].roomId);
  for (const follower of plan.kind === 'detach' ? [] : sharing) {
    const run = { ...follower, partnerRun: runs[0], stationary: plan.kind !== 'move' };
    runs.push(run);
    runs[0].partnerRun = run;
    runs[0].width = plan.width ?? follower.width;
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

  // R1: the moved lines and the jogs adapt to the faces already in place.
  const context = {
    floor,
    specifications,
    tolerance: operation.attachmentTolerance ?? 0,
    keep: operation.keepContactThickness === true,
    kept: [],
  };
  // A widened wall is an explicit value on that piece (decision R1).
  if (plan.width != null)
    context.kept.push({ roomId: stretch.roomId, line: runs[1].line, width: plan.width });
  const distance =
    plan.kind === 'move' ? seatDistance(primary, runs, plan.distance, context) : plan.distance;
  const out = { x: -inward(stretch.line).x, y: -inward(stretch.line).y };
  const delta = { x: out.x * distance, y: out.y * distance };

  const additions = [];
  const moving = runs.filter((run) => !run.stationary);
  for (const run of moving) {
    const room = primary.rooms.find((entry) => entry.id === run.roomId);
    const ends = [false, true].map((atEnd) =>
      seatJogStation(primary, run, planEnd(derived, run, atEnd, delta), atEnd, delta, context)
    );
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
      if (anchor || entry.jog) additions.push({ room, edgeId, anchor, jog: entry.jog });
    }
  }
  anchorNewEdges(primary, additions, specifications, createId);
  primary.contactWidths = explicitContactWidths(
    primary,
    derived,
    moving.map((run) => run.roomId),
    context
  );
  const edited = new Set(moving.map((run) => run.roomId));
  return { result: {}, preferredRoomIds: all.filter((id) => !edited.has(id)) };
}
