import { buildingPlanPinIssues } from '../corner-edits.js';
import { buildingPlanBoundaryClearanceIssues } from '../footprints.js';
import { findBuildingPlanFloor } from '../model.js';
import { extractBuildingPlanPrimary } from './extract.js';
import { deriveBuildingPlanPrimary } from './index.js';
import { applyRoomCommand } from './room-commands.js';
import { resizeFace } from './face-commands.js';
import { moveCorner } from './corner-commands.js';
import { writeBackBuildingPlanFloor } from './write-back.js';

/** Operations that run on the derived core (step 3); the others stay on today's engine. */
export const DERIVED_OPERATIONS = Object.freeze([
  'create_room',
  'move_room',
  'remove_room',
  'resize_face',
  'move_corner',
]);
const FACE_COMMANDS = { resize_face: resizeFace, move_corner: moveCorner };
export const usesDerivedPath = (operation) => DERIVED_OPERATIONS.includes(operation?.type);

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
 * Apply a room or face operation to a candidate snapshot through the derived core: extract the
 * floor's primary data, apply the command, derive, and write the floor back in place.
 *
 * @returns {{result: Object, divisions: Array<Object>, issues: Array<Object>}}
 */
export function applyDerivedOperation(
  snapshot,
  operation,
  { createId, specifications, editingPolicy = {} }
) {
  const floor = findBuildingPlanFloor(snapshot, operation.floorId);
  const primary = extractBuildingPlanPrimary(floor);
  const command = FACE_COMMANDS[operation.type];
  const { result, preferredRoomIds } = command
    ? command(primary, operation, { createId, specifications, editingPolicy })
    : applyRoomCommand(primary, operation, { createId, specifications });
  const written = writeFloor(snapshot, floor, primary, {
    createId,
    specifications,
    preferredRoomIds,
  });
  return { result, ...written };
}

/** Write a floor of a derived candidate again after a decision changed its answers. */
export function rederiveFloor(snapshot, floorId, { createId, specifications }) {
  const floor = findBuildingPlanFloor(snapshot, floorId);
  return writeFloor(snapshot, floor, extractBuildingPlanPrimary(floor), {
    createId,
    specifications,
  });
}

/**
 * Split the write-back's issues as today's reconciliation does: conflicting room defaults become
 * a question; any other issue refuses the edit. Pins and wall clearance are checked as today.
 */
export function derivedCandidateIssues(before, candidate, operation, writeIssues) {
  const defaultConflicts = writeIssues.filter(
    (issue) => issue.code === 'conflicting_room_defaults'
  );
  const issues = writeIssues.filter((issue) => issue.code !== 'conflicting_room_defaults');
  if (issues.length) return { defaultConflicts, issues };
  const floor = candidate.floors.find((entry) => entry.id === operation.floorId);
  return {
    defaultConflicts,
    issues: [
      ...buildingPlanPinIssues(before, candidate, operation.pinnedFaceIds),
      ...(floor ? buildingPlanBoundaryClearanceIssues(floor) : []),
    ],
  };
}
