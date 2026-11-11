import { propertySpecification, resolveInheritedProperty } from '../inheritance.js';

const EMPTY_SUBJECT = Object.freeze({
  id: null,
  overrides: {},
  providerOverrides: {},
  values: {},
  properties: {},
  sides: [],
});

/**
 * Resolve the thickness a wall subject would have between the given rooms. The prospective wall
 * carries the room pair and exposure, so exterior/interior defaults and room defaults apply as
 * they would after the contact exists. A subject override always wins.
 *
 * @param {Object} floor Stored floor (defaults, providers, rooms).
 * @param {Object} specifications Session property specifications.
 * @param {Object|null} subject Stored wall subject, or null for an unanchored span.
 * @param {[string, string|null]} roomIds Rooms on either side; null for outside.
 * @returns {{value: number|null}|{conflict: Object}}
 */
export function resolveWallThickness(floor, specifications, subject, roomIds) {
  const base = subject || EMPTY_SUBJECT;
  const prospective = {
    ...base,
    exposure: roomIds.every(Boolean) ? 'interior' : 'exterior',
    sides: [
      { ...(base.sides?.find((side) => side.sign === -1) || {}), sign: -1, roomId: roomIds[0] },
      { ...(base.sides?.find((side) => side.sign === 1) || {}), sign: 1, roomId: roomIds[1] },
    ],
  };
  const result = resolveInheritedProperty(
    { floor, subject: prospective, wall: prospective, nodeKey: 'walls' },
    'wall_thickness_m',
    propertySpecification(specifications, 'wall_thickness_m')
  );
  return result.conflict ? { conflict: result.conflict } : { value: result.value };
}
