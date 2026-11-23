import { buildingPlanFloorsByLevel } from './floor-order.js';
import { buildingPlanFootprints } from './footprints.js';
import { midlineJunctions } from './column-wall-targets.js';

const read = (floor, name) => floor.values?.[name];
const elevationOf = (floor) => {
  const value = read(floor, 'floor_elevation');
  return value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
};

/**
 * The floor directly below a floor, for a canvas to draw under it (the floor below, F2,
 * 2026-11-22; display only, nothing stored): the nearest floor before it in level order with a
 * lower story elevation. None for a floor without an elevation, or the lowest (U1). Floors share
 * one coordinate frame, so its outlines lie where they are drawn.
 * @param {object[]} floors the plan's floors
 * @param {object | undefined} floor the floor shown (one of `floors`)
 * @param {number} gridSize canvas units a metre
 * @returns {{ id: string, walls: Array<Array<{ x: number, y: number }>>,
 *   columns: Array<Array<{ x: number, y: number }>>,
 *   midlines: Array<[{ x: number, y: number }, { x: number, y: number }]>,
 *   junctions: Array<{ x: number, y: number }> } | null} its wall bands' and its columns'
 *   outlines, its walls' midlines (their axes, halfway between their faces) and where those meet,
 *   in canvas units (a free wall drawn above stacks on them, 2026-11-23)
 */
export function buildingPlanFloorBelow(floors, floor, gridSize) {
  const elevation = floor ? elevationOf(floor) : null;
  if (elevation == null) return null;
  const levels = buildingPlanFloorsByLevel(floors, read);
  const below = levels
    .slice(0, levels.indexOf(floor))
    .reverse()
    .find((entry) => {
      const other = elevationOf(entry);
      return other != null && other < elevation;
    });
  if (!below) return null;
  const pixels = (x, y) => ({ x: x * gridSize, y: y * gridSize });
  const columns = below.rooms.flatMap((room) =>
    (room.columns || [])
      .filter((column) => column.position && column.width > 0 && column.height > 0)
      .map(({ position: { x, y }, width, height }) => [
        pixels(x - width / 2, y - height / 2),
        pixels(x + width / 2, y - height / 2),
        pixels(x + width / 2, y + height / 2),
        pixels(x - width / 2, y + height / 2),
      ])
  );
  const { wallFootprints } = buildingPlanFootprints(below, gridSize);
  const midlines = below.walls.flatMap((wall) =>
    (wall.segments || []).map((segment) => [
      pixels(segment.start.x, segment.start.y),
      pixels(segment.end.x, segment.end.y),
    ])
  );
  return {
    id: below.id,
    walls: wallFootprints.flatMap((wall) => wall.polygons),
    columns,
    midlines,
    junctions: midlineJunctions(midlines, gridSize),
  };
}
