import { copyBuildingPlanData as copy, findRoom, planIssue } from './model.js';

/** The room element operations, shared by today's engine and the derived core. */
export const ELEMENT_OPERATIONS = Object.freeze([
  'create_element',
  'update_element',
  'remove_element',
]);

const refuse = (code, message) => {
  const error = new Error(message);
  error.issues = [planIssue(code, message)];
  throw error;
};

/**
 * Apply `create_element`, `update_element` or `remove_element` to a room's columns, beams or
 * objects on the stored floor.
 *
 * @returns {{created?: {type: string, id: string}}}
 */
export function applyElementOperation(floor, operation, createId) {
  const room = findRoom(floor, operation.roomId);
  if (!['columns', 'beams', 'objects'].includes(operation.collection))
    refuse('unknown_collection', 'Choose a supported room element collection.');
  const list = room[operation.collection];
  if (operation.type === 'create_element') {
    const item = {
      id: operation.id || createId(),
      ...copy(operation.element || {}),
      values: copy(operation.values || {}),
    };
    list.push(item);
    return { created: { type: operation.collection, id: item.id } };
  }
  const item = list.find((entry) => entry.id === operation.elementId);
  if (!item) refuse('missing_element', 'The room element no longer exists.');
  if (operation.type === 'remove_element')
    room[operation.collection] = list.filter((entry) => entry !== item);
  else Object.assign(item, copy(operation.element || {}), { id: item.id });
  return {};
}
