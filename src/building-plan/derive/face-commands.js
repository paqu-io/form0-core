import { SAME } from './grid.js';
import { deriveBuildingPlanPieces } from './pieces.js';
import { resolutionFloor } from './thickness.js';
import { explicitContactWidths, seatDistance, seatJogStation } from './face-contacts.js';
import { keepWallWithStationaryRoom, sharedWallMode, widenPlan } from './shared-wall-drag.js';
import { followers, inward, locateFace } from './face-plans.js';
import { editRuns, prepareEnds } from './run-edits.js';
import { junctionFollowers } from './junction-follow.js';
import { seatLengthenedStretches } from './lengthened-seats.js';
import { entryReturnDistance } from './entry-return.js';

const refuse = (code, message, subject) => {
  throw Object.assign(new Error(message), {
    issues: [{ code, message, ...(subject ? { subject } : {}) }],
  });
};

/** The dragged stretch and the neighbours sharing it, on the floor as it is now. */
function prepareFace(primary, operation, specifications) {
  const derived = deriveBuildingPlanPieces(primary, specifications);
  const stretch = locateFace(primary, operation, derived.lines);
  return { derived, stretch, sharing: followers(derived, derived.lines, stretch) };
}

/**
 * `resize_face` on the derived core: the row's edge (or `interval`) moves `distance` outward from
 * its room; rooms sharing it follow; each end slides at a corner or makes a jog.
 *
 * In an editor (`entryFloors`), a drag away from the neighbour first moves the whole wall back as
 * far as earlier pushes in that editor moved the neighbour's face, then widens (the kept notch,
 * option 2; `entry-return.js`).
 *
 * @returns {{result: Object, preferredRoomIds: string[]}}
 */
export function resizeFace(primary, operation, options) {
  if (!Number.isFinite(operation.distance))
    refuse('invalid_dimension', 'A finite face displacement is required.');
  const prepared = prepareFace(primary, operation, options.specifications);
  const back = entryReturnDistance(operation, prepared, options);
  if (back <= SAME) return resizeOnce(primary, operation, options, prepared);
  const returned = resizeOnce(
    primary,
    { ...operation, distance: -back, sharedWallDrag: 'move_wall' },
    options,
    prepared
  );
  const rest = operation.distance + back;
  if (Math.abs(rest) <= SAME) return returned;
  const widened = resizeOnce(primary, { ...operation, distance: rest }, options);
  return {
    result: {},
    preferredRoomIds: returned.preferredRoomIds.filter((id) =>
      widened.preferredRoomIds.includes(id)
    ),
  };
}

function resizeOnce(
  primary,
  operation,
  { createId, specifications, editingPolicy },
  { derived, stretch, sharing } = prepareFace(primary, operation, specifications)
) {
  const all = primary.rooms.map((room) => room.id);
  if (Math.abs(operation.distance) <= SAME) return { result: {}, preferredRoomIds: all };

  const floor = resolutionFloor(primary);
  const runs = [{ ...stretch, preferMoved: [stretch.edgeId] }];
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
  // M6: a stretch the edit lengthened into another room's wall lands at the contact's width.
  const editedIds = [...new Set(moving.map((run) => run.roomId))];
  seatLengthenedStretches(primary, derived, editedIds, context, createId);
  primary.contactWidths = explicitContactWidths(
    primary,
    derived,
    moving.map((run) => run.roomId),
    context
  );
  const edited = new Set(moving.map((run) => run.roomId));
  return { result: {}, preferredRoomIds: all.filter((id) => !edited.has(id)) };
}
