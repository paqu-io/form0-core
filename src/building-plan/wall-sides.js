import { copyEventData as copy } from '../utilities/event-data.js';

export function createWallSides(createId) {
  return [-1, 1].map((sign) => ({
    id: createId(),
    sign,
    roomId: null,
    values: {},
    overrides: {},
    properties: {},
    provenance: {},
    repeatable: {},
  }));
}

export function wallSide(floor, face, outside = false) {
  const wall = floor.walls.find((entry) => entry.id === face.wallId);
  if (outside) {
    const current = wallSide(floor, face);
    return wall?.sides?.find(
      (side) => side.id !== current?.id && (!side.roomId || side.roomId === current?.roomId)
    );
  }
  return (
    wall?.sides?.find((side) => side.id === face.sideId) ||
    wall?.sides?.find((side) => side.sign === face.bindings?.[0]?.side)
  );
}

/** Merge the same physical surfaces, preserving the reference wall's side identities. */
export function mergeWallSides(reference, other, direction) {
  if (!reference.sides || !other.sides) return new Map();
  const remapped = new Map();
  for (const source of other.sides) {
    const target = reference.sides.find((side) => side.sign === source.sign * direction);
    if (!target) continue;
    for (const [property, value] of Object.entries(source.overrides || {})) {
      if (
        Object.hasOwn(target.overrides, property) &&
        JSON.stringify(target.overrides[property]) !== JSON.stringify(value)
      ) {
        const error = new Error(
          'Resolve the differing accepted answers on this physical wall surface.'
        );
        error.issues = [{ code: 'conflicting_surface_answers', message: error.message, property }];
        throw error;
      }
      target.overrides[property] = copy(value);
    }
    for (const key of ['values', 'providerOverrides']) {
      for (const [property, value] of Object.entries(source[key] || {})) {
        target[key] ||= {};
        if (
          Object.hasOwn(target[key], property) &&
          JSON.stringify(target[key][property]) !== JSON.stringify(value)
        ) {
          const error = new Error('Resolve the differing answers on this physical wall surface.');
          error.issues = [
            { code: 'conflicting_surface_answers', message: error.message, property },
          ];
          throw error;
        }
        target[key][property] = copy(value);
      }
    }
    for (const [key, rows] of Object.entries(source.repeatable || {})) {
      if (
        target.repeatable[key]?.length &&
        rows.length &&
        JSON.stringify(target.repeatable[key]) !== JSON.stringify(rows)
      ) {
        const error = new Error('Resolve custom records on this surface before joining it.');
        error.issues = [{ code: 'conflicting_surface_records', message: error.message }];
        throw error;
      }
      if (rows.length) target.repeatable[key] = copy(rows);
    }
    target.roomId ||= source.roomId;
    remapped.set(source.id, target.id);
  }
  return remapped;
}
