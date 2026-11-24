import { distance } from './geometry.js';

/**
 * Where a new beam sits (wall beams, 2026-11-24, P2: the height is stored, filled once here).
 * A room beam added from its list is 15 by 30 cm, as the canvas draws one (3a).
 */
export const NEW_BEAM_WIDTH = 0.15;
export const NEW_BEAM_DEPTH = 0.3;

const clean = (value) => Math.round(value * 1e9) / 1e9;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * The beam a wall's Beams list adds: along the whole stretch of the wall this room faces, as wide
 * as the wall, 30 cm deep, its top at the top of the wall (no height while the wall's is unknown).
 * @param {object} base the operation's floor
 * @param {object} wall the physical wall
 * @param {object | null} face the room's wall row it was added from
 */
export function newWallBeamOperation(base, wall, face) {
  const binding = face?.bindings?.[0];
  const segment =
    wall.segments.find((entry) => entry.id === binding?.segmentId) || wall.segments[0];
  const low = binding?.interval[0] || 0;
  const high = binding?.interval[1] ?? distance(segment.start, segment.end);
  const height = wall.properties?.wall_height;
  return {
    ...base,
    type: 'create_opening',
    kind: 'beam',
    wallId: wall.id,
    segmentId: segment.id,
    offset: low,
    length: clean(high - low),
    width: wall.properties?.wall_thickness ?? null,
    depth: NEW_BEAM_DEPTH,
    underside: finite(height) ? clean(height - NEW_BEAM_DEPTH) : null,
  };
}

/**
 * A new room beam's underside when none is given: its top at the room's structural clear height.
 * @param {object} room
 * @param {number} depth the beam's depth (its model `height`)
 * @returns {number | null}
 */
export function roomBeamUnderside(room, depth) {
  const clear = room?.properties?.room_structural_clear_height;
  return finite(clear) && finite(depth) ? clean(clear - depth) : null;
}
