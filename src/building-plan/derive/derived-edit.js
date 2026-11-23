import { beamPlacementIssues, beamTooShortIssues } from '../beam-contents.js';
import { buildingPlanPinIssues } from '../corner-edits.js';
import { buildingPlanBoundaryClearanceIssues } from '../footprints.js';
import {
  columnPlacementIssues,
  freeWallPlacementIssues,
  freeWallTooShortIssues,
} from '../room-contents.js';
import { findBuildingPlanFloor } from '../model.js';
import { extractBuildingPlanPrimary } from './extract.js';
import { deriveBuildingPlanPrimary } from './index.js';
import { applyRoomCommand } from './room-commands.js';
import { resizeFace } from './face-commands.js';
import { moveCorner } from './corner-commands.js';
import { resizePreserveGroup, resizeRoom } from './room-resizes.js';
import { rejoinCut, splitFace } from './cut-commands.js';
import { changeThickness } from './thickness-commands.js';
import { PARTITION_COMMANDS } from './partition-commands.js';
import { SELF_FACING_OPERATIONS, selfFacingWallIssues } from './self-facing-walls.js';
import {
  DATA_OPERATIONS,
  PROPERTY_OPERATIONS,
  applyDataEdits,
  floorContext,
  isDataBatch,
  isDataOperation,
  operationFloorIds,
  thicknessContext,
} from './data-commands.js';
import { writeBackBuildingPlanFloor } from './write-back.js';
import { followAttached } from './follow-attached.js';

/** Operations that run on the derived core (step 3); the others stay on today's engine. */
export const DERIVED_OPERATIONS = Object.freeze([
  'create_room',
  'move_room',
  'remove_room',
  'resize_face',
  'move_corner',
  'resize_room',
  'resize_preserve_group',
  'split_face',
  'rejoin_cut',
  ...Object.keys(PARTITION_COMMANDS),
  ...DATA_OPERATIONS,
]);
const FACE_COMMANDS = {
  resize_face: resizeFace,
  move_corner: moveCorner,
  resize_room: resizeRoom,
  resize_preserve_group: resizePreserveGroup,
  split_face: splitFace,
  rejoin_cut: rejoinCut,
  ...PARTITION_COMMANDS,
};
/** Derived operations, and batches made only of data operations (J3). */
export const usesDerivedPath = (operation) =>
  DERIVED_OPERATIONS.includes(operation?.type) || isDataBatch(operation);
export { operationFloorIds };

function writeFloor(snapshot, floor, primary, options) {
  const { specifications } = options;
  const written = writeBackBuildingPlanFloor(
    primary,
    deriveBuildingPlanPrimary(primary, specifications),
    options
  );
  snapshot.floors[snapshot.floors.indexOf(floor)] = written.floor;
  return {
    divisions: written.divisions.map((division) => ({ ...division, floorId: floor.id })),
    issues: written.issues,
  };
}

/**
 * Attached contents follow their wall (4b): what touched a line the edit moved (`before`, the
 * floor's primary data before it) moves with it; then the floor is written. A free wall or a
 * beam (3a-4) that following would leave too short refuses the edit, named.
 */
function followAndWrite(snapshot, floor, before, primary, options, operation) {
  const { shortFaceIds, shortBeamIds } = followAttached(before, primary, {
    specifications: options.specifications,
    operation,
  });
  const written = writeFloor(snapshot, floor, primary, options);
  if (!shortFaceIds.length && !shortBeamIds.length) return written;
  const edited = snapshot.floors.find((entry) => entry.id === floor.id);
  return {
    ...written,
    issues: [
      ...written.issues,
      ...freeWallTooShortIssues(edited, shortFaceIds),
      ...beamTooShortIssues(edited, shortBeamIds),
    ],
  };
}

/**
 * Apply a room or face operation to a candidate snapshot through the derived core: extract the
 * floor's primary data, apply the command, derive, and write the floor back in place.
 * `entryStates`: the plans the editor the edit runs in went through, earliest first (none outside
 * an editor).
 *
 * @returns {{result: Object, divisions: Array<Object>, issues: Array<Object>}}
 */
export function applyDerivedOperation(
  snapshot,
  operation,
  { createId, specifications, editingPolicy = {}, entryStates = null }
) {
  if (isDataOperation(operation))
    return applyDataOperation(snapshot, operation, { createId, specifications, editingPolicy });
  const floor = findBuildingPlanFloor(snapshot, operation.floorId);
  const primary = extractBuildingPlanPrimary(floor);
  const before = extractBuildingPlanPrimary(floor);
  const command = FACE_COMMANDS[operation.type];
  const entryFloors = (entryStates || [])
    .map((plan) => plan.floors?.find((entry) => entry.id === floor.id))
    .filter(Boolean);
  const { result, preferredRoomIds } = command
    ? command(primary, operation, { createId, specifications, editingPolicy, entryFloors })
    : applyRoomCommand(primary, operation, { createId, specifications });
  const written = followAndWrite(
    snapshot,
    floor,
    before,
    primary,
    { createId, specifications, preferredRoomIds },
    operation
  );
  return { result, ...written };
}

/**
 * A data operation or a batch of them (items 4b, 4c): openings and answers change on the stored
 * floors, and each floor's thickness changes move its rooms (`changeThickness`) before it is
 * written back.
 */
function applyDataOperation(snapshot, operation, options) {
  const { context, created, floors } = applyDataEdits(snapshot, operation, options);
  const carved = [];
  const divisions = [];
  const issues = [];
  for (const { floor, before, original, primary } of floors) {
    const { result, preferredRoomIds } = changeThickness(
      primary,
      before,
      floorContext(context, floor.id),
      options
    );
    carved.push(...result.carvedRoomIds);
    // Against the floor before any of the edits: a column only resized keeps its contacts (D6).
    const written = followAndWrite(
      snapshot,
      floor,
      original,
      primary,
      { ...options, preferredRoomIds },
      operation
    );
    divisions.push(...written.divisions);
    issues.push(...written.issues);
  }
  const result =
    operation.type === 'batch'
      ? { createdSubjects: created }
      : created.length
        ? { created: created[0] }
        : {};
  // A thickness change lists the rooms it carved (I5).
  if (operation.type === 'batch' || PROPERTY_OPERATIONS.includes(operation.type))
    result.carvedRoomIds = carved;
  return { result, divisions, issues };
}

/**
 * Write a floor of a derived candidate again after a decision changed its answers. After a
 * property operation (`change`: the operation, the candidate before the decision and the plan
 * before the operation), a thickness the decision changed moves the rooms as the operation would.
 *
 * @returns {{divisions: Array<Object>, issues: Array<Object>, carvedRoomIds: string[]}}
 */
export function rederiveFloor(snapshot, floorId, options, change = null) {
  const { createId, specifications, editingPolicy = {} } = options;
  const floor = findBuildingPlanFloor(snapshot, floorId);
  const primary = extractBuildingPlanPrimary(floor);
  let moved = { result: { carvedRoomIds: [] }, preferredRoomIds: undefined };
  let before = null;
  if (change && isDataOperation(change.operation)) {
    before = extractBuildingPlanPrimary(findBuildingPlanFloor(change.previous, floorId));
    const context = thicknessContext(change.current, change.operation, editingPolicy);
    moved = changeThickness(primary, before, floorContext(context, floorId), options);
  }
  const writeOptions = { createId, specifications, preferredRoomIds: moved.preferredRoomIds };
  const written = before
    ? followAndWrite(snapshot, floor, before, primary, writeOptions, change.operation)
    : writeFloor(snapshot, floor, primary, writeOptions);
  return { ...written, carvedRoomIds: moved.result.carvedRoomIds };
}

/**
 * Split the write-back's issues as today's reconciliation does: conflicting room defaults become
 * a question; any other issue refuses the edit. Pins and wall clearance are checked as today; a
 * face or corner drag must not leave a slit against the room's own wall (Q5); columns and free
 * walls stay where they may (`room-contents.js`), beams too (`beam-contents.js`).
 */
export function derivedCandidateIssues(before, candidate, operation, writeIssues) {
  const defaultConflicts = writeIssues.filter(
    (issue) => issue.code === 'conflicting_room_defaults'
  );
  const issues = writeIssues.filter((issue) => issue.code !== 'conflicting_room_defaults');
  if (issues.length) return { defaultConflicts, issues };
  const floors = operationFloorIds(operation)
    .map((id) => candidate.floors.find((entry) => entry.id === id))
    .filter(Boolean);
  const selfFacing = SELF_FACING_OPERATIONS.includes(operation.type)
    ? floors.flatMap((floor) => {
        const previous = before.floors.find((entry) => entry.id === floor.id);
        return previous ? selfFacingWallIssues(previous, floor) : [];
      })
    : [];
  return {
    defaultConflicts,
    issues: [
      ...buildingPlanPinIssues(before, candidate, operation.pinnedFaceIds),
      ...floors.flatMap((floor) => buildingPlanBoundaryClearanceIssues(floor)),
      ...selfFacing,
      // Columns stay in their room and its walls, clear of each other and of openings (4a-1).
      ...floors.flatMap((floor) =>
        columnPlacementIssues(
          floor,
          before.floors.find((entry) => entry.id === floor.id)
        )
      ),
      // Free walls stay in their room, room edits included (4a-2).
      ...floors.flatMap((floor) => freeWallPlacementIssues(floor)),
      // Beams too, their bodies included (3a-3).
      ...floors.flatMap((floor) =>
        beamPlacementIssues(
          floor,
          before.floors.find((entry) => entry.id === floor.id)
        )
      ),
    ],
  };
}
