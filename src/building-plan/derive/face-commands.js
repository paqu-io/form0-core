import { SAME } from './grid.js';
import { deriveBuildingPlanPieces } from './pieces.js';
import { resolutionFloor } from './thickness.js';
import { explicitContactWidths, seatDistance, seatJogStation } from './face-contacts.js';
import { keepWallWithStationaryRoom, sharedWallMode, widenPlan } from './shared-wall-drag.js';
import { followers, inward, locateFace } from './face-plans.js';
import { editRuns, prepareEnds } from './run-edits.js';
import { junctionFollowers } from './junction-follow.js';

const refuse = (code, message, subject) => {
  throw Object.assign(new Error(message), {
    issues: [{ code, message, ...(subject ? { subject } : {}) }],
  });
};

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
  // A detached neighbour stays as the stationary partner: the moved stretch's jogs still return
  // against its walls as while widening or holding.
  for (const follower of sharing) {
    const run = {
      ...follower,
      partnerRun: runs[0],
      stationary: plan.kind !== 'move',
      detached: plan.kind === 'detach',
    };
    runs.push(run);
    runs[0].partnerRun = run;
    runs[0].width = plan.width ?? follower.width;
  }
  prepareEnds(derived, runs);

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

  // Neighbours whose junction sits at a corner the drag slides along a shared wall follow it.
  const moving = [
    ...runs.filter((run) => !run.stationary),
    ...junctionFollowers(
      derived,
      runs,
      delta,
      sharing.map((entry) => entry.roomId)
    ),
  ];
  editRuns(primary, derived, moving, delta, {
    createId,
    specifications,
    seatJog: (run, plan, atEnd) => seatJogStation(primary, run, plan, atEnd, delta, context),
  });
  primary.contactWidths = explicitContactWidths(
    primary,
    derived,
    moving.map((run) => run.roomId),
    context
  );
  const edited = new Set(moving.map((run) => run.roomId));
  return { result: {}, preferredRoomIds: all.filter((id) => !edited.has(id)) };
}
