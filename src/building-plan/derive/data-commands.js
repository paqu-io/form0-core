import { findBuildingPlanFloor, findFace, reconcileBuildingPlanProperties } from '../model.js';
import { VALUE_OPERATIONS, applyProperty, applyValueOperation } from '../property-edits.js';
import { ELEMENT_OPERATIONS, applyElementOperation } from '../element-operations.js';
import { OPENING_OPERATIONS, applyOpeningOperation } from '../opening-operations.js';
import { extractBuildingPlanPrimary } from './extract.js';

export const PROPERTY_OPERATIONS = Object.freeze(['set_property', 'set_defaults', 'set_provider']);
/** Operations that edit stored data only; a thickness they change moves rooms afterwards. */
export const DATA_OPERATIONS = Object.freeze([
  ...PROPERTY_OPERATIONS,
  ...OPENING_OPERATIONS,
  ...VALUE_OPERATIONS,
  ...ELEMENT_OPERATIONS,
]);

const refuse = (code, message) => {
  throw Object.assign(new Error(message), { issues: [{ code, message }] });
};

/** A batch the derived core runs whole: a flat list of data operations only (J3). */
export const isDataBatch = (operation) =>
  operation?.type === 'batch' &&
  Array.isArray(operation.operations) &&
  operation.operations.length > 0 &&
  operation.operations.every((entry) => DATA_OPERATIONS.includes(entry?.type));

/** A data operation or a batch of them. */
export const isDataOperation = (operation) =>
  DATA_OPERATIONS.includes(operation?.type) || isDataBatch(operation);

/** The entries of a data operation or batch, each with its floor. */
const entriesOf = (operation) =>
  (operation.type === 'batch' ? operation.operations : [operation]).map((entry) => ({
    ...entry,
    floorId: entry.floorId ?? operation.floorId,
  }));

/** The floors a derived operation edits. */
export const operationFloorIds = (operation) =>
  isDataOperation(operation)
    ? [...new Set(entriesOf(operation).map((entry) => entry.floorId))]
    : [operation.floorId];

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
    if (!entry.faceId || !PROPERTY_OPERATIONS.includes(entry.type)) continue;
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
 * Apply the data edits of an operation or batch to the stored floors with today's code (J4, rule
 * 12): openings first, on the walls the host saw, then values, custom rows and room elements in
 * their order, then property answers. Each edited floor is read into primary data with the
 * property answers before (`before`) and after (`primary`); geometry is the same.
 *
 * @returns {{context: Object, created: Array<Object>, floors: Array<{floor: Object,
 *   before: Object, primary: Object}>}}
 */
export function applyDataEdits(snapshot, operation, { createId, specifications, editingPolicy }) {
  const context = thicknessContext(snapshot, operation, editingPolicy);
  const entries = entriesOf(operation);
  const created = [];
  const edit = (entry) => {
    const floor = findBuildingPlanFloor(snapshot, entry.floorId);
    if (VALUE_OPERATIONS.includes(entry.type)) return applyValueOperation(floor, entry);
    const result = OPENING_OPERATIONS.includes(entry.type)
      ? applyOpeningOperation(floor, entry, createId)
      : applyElementOperation(floor, entry, createId);
    if (result.created) created.push(result.created);
  };
  for (const entry of entries.filter((e) => OPENING_OPERATIONS.includes(e.type))) edit(entry);
  for (const entry of entries.filter(
    (e) => VALUE_OPERATIONS.includes(e.type) || ELEMENT_OPERATIONS.includes(e.type)
  ))
    edit(entry);
  const before = new Map();
  for (const entry of entries) {
    const floor = findBuildingPlanFloor(snapshot, entry.floorId);
    if (!before.has(floor.id)) before.set(floor.id, extractBuildingPlanPrimary(floor));
  }
  for (const entry of entries.filter((e) => PROPERTY_OPERATIONS.includes(e.type)))
    applyProperty(findBuildingPlanFloor(snapshot, entry.floorId), entry, specifications);
  const issues = reconcileBuildingPlanProperties(snapshot, specifications).filter(
    (issue) => issue.code !== 'conflicting_room_defaults'
  );
  if (issues.length) throw Object.assign(new Error(issues[0].message), { issues });
  return {
    context,
    created,
    floors: [...before].map(([floorId, primary]) => {
      const floor = findBuildingPlanFloor(snapshot, floorId);
      return { floor, before: primary, primary: extractBuildingPlanPrimary(floor) };
    }),
  };
}
