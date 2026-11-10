import { buildingPlanPinIssues } from './corner-edits.js';
import { capturedBoundaryIssues } from './boundary-edits.js';
import { buildingPlanBoundaryClearanceIssues } from './footprints.js';
import {
  copyBuildingPlanData as copy,
  equalValue,
  findFace,
  own,
  planIssue,
  reconcileBuildingPlanProperties,
  validateBuildingPlanSnapshot,
} from './model.js';
import { normalizePhysicalPieces, buildingPlanOwnershipIssues } from './physical-pieces.js';
import { reconcileWallLabels } from './wall-labels.js';
import { applyThicknessChanges, reconcileBuildingPlanContacts } from './operations.js';
import { normalizeBuildingPlanMaterialCaps } from './material-profiles.js';
import { keepsContactThickness } from './attachment-seating.js';

const CONTACT_EDITS = new Set([
  'resize_face',
  'resize_room',
  'move_corner',
  'move_room',
  'set_property',
  'set_defaults',
  'set_provider',
]);
const discoversContacts = (operation) =>
  operation.type === 'batch'
    ? operation.operations.some(discoversContacts)
    : operation.attach === true || CONTACT_EDITS.has(operation.type);

/** Resolve selection once, before temporary physical divisions can replace its owner. */
export function buildingPlanEditContext(snapshot, operation, editingPolicy) {
  const context = {
    ...operation,
    thicknessAnchor: operation.thicknessAnchor ?? editingPolicy.thicknessAnchor,
  };
  const floor = snapshot.floors.find((entry) => entry.id === operation.floorId);
  if (floor && operation.faceId) context.activeRoomId ??= findFace(floor, operation.faceId).room.id;
  context.activeRoomId ??= operation.roomId;
  if (operation.type === 'batch' && Array.isArray(operation.operations)) {
    context.operations = operation.operations.map((entry) =>
      buildingPlanEditContext(snapshot, entry, editingPolicy)
    );
    context.activeRoomsByWall = { ...operation.activeRoomsByWall };
    for (const entry of context.operations) {
      const owner = snapshot.floors.find((floor) => floor.id === entry.floorId);
      if (owner && entry.faceId)
        context.activeRoomsByWall[findFace(owner, entry.faceId).wall.id] = entry.activeRoomId;
    }
    const rooms = new Set(context.operations.map((entry) => entry.activeRoomId).filter(Boolean));
    if (rooms.size === 1) context.activeRoomId ??= [...rooms][0];
  }
  return context;
}

/**
 * "Keep previous values" for an attached room: record each width that inheritance would
 * change as an override, so the seated geometry is kept rather than refitted.
 * Returns whether any override was added.
 */
function keepGeometricWidths(floors, geometry) {
  let kept = false;
  for (const floor of floors) {
    const previous = geometry.floors.find((entry) => entry.id === floor.id);
    for (const wall of floor.walls) {
      const width = previous.walls.find((entry) => entry.id === wall.id)?.properties
        .wall_thickness_m;
      if (
        !Number.isFinite(width) ||
        width === wall.properties.wall_thickness_m ||
        own(wall.overrides, 'wall_thickness_m')
      )
        continue;
      wall.overrides = { ...wall.overrides, wall_thickness_m: width };
      kept = true;
    }
  }
  return kept;
}

// Convergence concerns geometry/coverage, not disposable binding IDs or provenance maps.
function contactState(floors) {
  return JSON.stringify(
    floors.map((floor) => [
      floor.id,
      floor.rooms.map((room) => [
        room.id,
        room.vertices.map((point) => [point.x, point.y, point.editingCutId || null]),
      ]),
      floor.walls
        .map((wall) => [
          wall.segments.map((span) => [span.start.x, span.start.y, span.end.x, span.end.y]),
          wall.properties.wall_thickness_m,
          wall.exposure,
          wall.sides.map((side) => [side.sign, side.roomId]),
        ])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ])
  );
}

/**
 * Settle one private candidate before acceptance or a managed question. Session state,
 * history and UI remain with the caller. Decision-induced writes cross this same seam.
 */
export function reconcileBuildingPlanCandidate(
  candidate,
  before,
  operation,
  { createId, specifications }
) {
  const floors = candidate.floors.filter(
    (floor) =>
      !equalValue(
        floor,
        before.floors.find((entry) => entry.id === floor.id)
      )
  );
  const divisions = [];
  let defaultConflicts = [];
  const seen = new Set();
  const limit = 2 + floors.reduce((count, floor) => count + floor.walls.length, 0);
  for (let pass = 0; ; pass++) {
    const state = contactState(floors);
    if (seen.has(state) || pass > limit)
      return {
        divisions,
        defaultConflicts,
        issues: [
          planIssue('unstable_wall_contacts', 'The changed wall contacts could not be reconciled.'),
        ],
      };
    seen.add(state);
    for (const floor of floors) {
      if (discoversContacts(operation))
        reconcileBuildingPlanContacts(floor, operation, createId, specifications);
      divisions.push(
        ...normalizePhysicalPieces(
          floor,
          createId,
          before.floors.find((entry) => entry.id === floor.id)
        ).map((division) => ({ ...division, floorId: floor.id }))
      );
    }
    const geometry = copy(candidate);
    let resolved = reconcileBuildingPlanProperties(candidate, specifications);
    if (keepsContactThickness(operation) && keepGeometricWidths(floors, geometry))
      resolved = reconcileBuildingPlanProperties(candidate, specifications);
    defaultConflicts = resolved.filter((issue) => issue.code === 'conflicting_room_defaults');
    const issues = resolved.filter((issue) => issue.code !== 'conflicting_room_defaults');
    if (issues.length) return { divisions, defaultConflicts, issues };
    for (const floor of floors) {
      const previous = geometry.floors.find((entry) => entry.id === floor.id);
      if (
        !floor.walls.some(
          (wall) =>
            wall.properties.wall_thickness_m !==
            previous.walls.find((entry) => entry.id === wall.id)?.properties.wall_thickness_m
        )
      )
        continue;
      applyThicknessChanges(
        floor,
        previous,
        operation.activeRoomId,
        createId,
        operation,
        specifications
      );
    }
    if (contactState(floors) === state) break;
  }
  // Canonical cap classification depends on settled coverage and inherited
  // properties. Private solver copies retire during convergence above.
  for (const floor of floors) {
    const retired = normalizeBuildingPlanMaterialCaps(floor, createId);
    if (!retired.size) continue;
    divisions.push(
      ...normalizePhysicalPieces(
        floor,
        createId,
        before.floors.find((entry) => entry.id === floor.id)
      ).map((division) => ({ ...division, floorId: floor.id }))
    );
    const live = new Set(floor.walls.map((wall) => wall.id));
    for (const division of divisions.filter((division) => division.floorId === floor.id))
      division.walls = division.walls.filter((wall) => live.has(wall.id));
  }
  for (const floor of floors)
    reconcileWallLabels(
      floor,
      before.floors.find((entry) => entry.id === floor.id)
    );
  const issues = [
    ...buildingPlanPinIssues(before, candidate, operation.pinnedFaceIds),
    ...validateBuildingPlanSnapshot(candidate),
    ...capturedBoundaryIssues(before, candidate),
    ...floors.flatMap(buildingPlanOwnershipIssues),
  ];
  if (!issues.length)
    for (const floor of floors) issues.push(...buildingPlanBoundaryClearanceIssues(floor));
  return { divisions, defaultConflicts, issues };
}
