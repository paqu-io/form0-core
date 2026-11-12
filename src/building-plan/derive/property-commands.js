import { findBuildingPlanFloor, findFace, reconcileBuildingPlanProperties } from '../model.js';
import { applyProperty } from '../property-edits.js';
import { extractBuildingPlanPrimary } from './extract.js';

export const PROPERTY_OPERATIONS = Object.freeze(['set_property', 'set_defaults', 'set_provider']);

const refuse = (code, message) => {
  throw Object.assign(new Error(message), { issues: [{ code, message }] });
};

/** A batch the derived core runs whole: a flat list of property operations only (J3). */
export const isPropertyBatch = (operation) =>
  operation?.type === 'batch' &&
  Array.isArray(operation.operations) &&
  operation.operations.length > 0 &&
  operation.operations.every((entry) => PROPERTY_OPERATIONS.includes(entry?.type));

/** The entries of a property operation or batch, each with its floor. */
const entriesOf = (operation) =>
  (operation.type === 'batch' ? operation.operations : [operation]).map((entry) => ({
    ...entry,
    floorId: entry.floorId ?? operation.floorId,
  }));

/** The floors a derived operation edits. */
export const operationFloorIds = (operation) =>
  PROPERTY_OPERATIONS.includes(operation?.type) || operation?.type === 'batch'
    ? [...new Set(entriesOf(operation).map((entry) => entry.floorId))]
    : [operation.floorId];

/** A property operation or a batch of them. */
export const isPropertyOperation = (operation) =>
  PROPERTY_OPERATIONS.includes(operation?.type) || isPropertyBatch(operation);

/**
 * Rule 7's anchor context, read from the plan before the operation: the anchor policy, the room
 * of the row each entry edited (per floor and wall), and the operation's active room.
 */
export function thicknessContext(snapshot, operation, editingPolicy = {}) {
  const thicknessAnchor = operation.thicknessAnchor ?? editingPolicy.thicknessAnchor ?? 'room_face';
  if (!['room_face', 'midline'].includes(thicknessAnchor))
    refuse('invalid_editing_policy', 'thicknessAnchor must be room_face or midline.');
  const activeRoomsByWall = {};
  for (const entry of entriesOf(operation)) {
    activeRoomsByWall[entry.floorId] ||= {};
    if (!entry.faceId) continue;
    const selected = findFace(findBuildingPlanFloor(snapshot, entry.floorId), entry.faceId);
    activeRoomsByWall[entry.floorId][selected.wall.id] = entry.activeRoomId || selected.room.id;
  }
  const activeRoomId =
    operation.activeRoomId ?? (operation.type === 'batch' ? null : operation.roomId) ?? null;
  return { thicknessAnchor, activeRoomId, activeRoomsByWall };
}

/** The anchor context of one floor, as `changeThickness` reads it. */
export const floorContext = (context, floorId) => ({
  thicknessAnchor: context.thicknessAnchor,
  activeRoomId: context.activeRoomId,
  activeRoomsByWall: context.activeRoomsByWall[floorId] || {},
});

/**
 * Apply the answers of a property operation or batch to the stored floors with today's code
 * (J4), and read each edited floor into primary data before and after: only answers differ.
 *
 * @returns {{context: Object, floors: Array<{floor: Object, before: Object, primary: Object}>}}
 */
export function applyPropertyAnswers(snapshot, operation, { specifications, editingPolicy = {} }) {
  const context = thicknessContext(snapshot, operation, editingPolicy);
  const before = new Map();
  for (const entry of entriesOf(operation)) {
    const floor = findBuildingPlanFloor(snapshot, entry.floorId);
    if (!before.has(floor.id)) before.set(floor.id, extractBuildingPlanPrimary(floor));
    applyProperty(floor, entry, specifications);
  }
  const issues = reconcileBuildingPlanProperties(snapshot, specifications).filter(
    (issue) => issue.code !== 'conflicting_room_defaults'
  );
  if (issues.length) throw Object.assign(new Error(issues[0].message), { issues });
  return {
    context,
    floors: [...before].map(([floorId, primary]) => {
      const floor = findBuildingPlanFloor(snapshot, floorId);
      return { floor, before: primary, primary: extractBuildingPlanPrimary(floor) };
    }),
  };
}
