import { copyBuildingPlanData as copy, findWall, own, planIssue } from './model.js';

/** The opening operations, shared by today's engine and the derived core. */
export const OPENING_OPERATIONS = Object.freeze([
  'create_opening',
  'update_opening',
  'remove_opening',
]);

const refuse = (code, message) => {
  const error = new Error(message);
  error.issues = [planIssue(code, message)];
  throw error;
};

/**
 * Apply `create_opening`, `update_opening` or `remove_opening` to the stored floor: the opening
 * lives on its wall's segment, at `offset` metres from the segment's start. Whether it fits is
 * checked by the snapshot validation afterwards.
 *
 * @returns {{created?: {type: string, id: string}}}
 */
export function applyOpeningOperation(floor, operation, createId) {
  const wall = findWall(floor, operation.wallId);
  if (operation.type === 'create_opening') {
    if (!['door', 'window'].includes(operation.kind))
      refuse('invalid_opening_type', 'Choose a door or a window.');
    const opening = {
      id: operation.id || createId(),
      type: operation.kind,
      segmentId: operation.segmentId || wall.segments[0]?.id,
      offset: operation.offset,
      width: operation.width,
      height: operation.height ?? null,
      sillHeight: operation.sillHeight ?? null,
      values: copy(operation.values || {}),
    };
    wall[operation.kind === 'door' ? 'doors' : 'windows'].push(opening);
    return { created: { type: opening.type, id: opening.id } };
  }
  const opening = [...wall.doors, ...wall.windows].find(
    (entry) => entry.id === operation.openingId
  );
  if (!opening) refuse('missing_opening', 'The opening no longer exists.');
  const list = opening.type === 'door' ? 'doors' : 'windows';
  if (operation.type === 'remove_opening')
    wall[list] = wall[list].filter((entry) => entry.id !== opening.id);
  else
    for (const key of ['offset', 'width', 'height', 'sillHeight', 'segmentId', 'values'])
      if (own(operation, key)) opening[key] = copy(operation[key]);
  return {};
}
