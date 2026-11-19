/**
 * What free walls snap to (`free-wall-snapping.js`), in canvas units, from the canvas snapshot.
 */

const columnCorners = (column, room, gridSize) => {
  const rect = room?.rect;
  if (!rect) return [];
  const centre = {
    x: rect.x + (column.centerU ?? 0.5) * rect.width,
    y: rect.y + (column.centerV ?? 0.5) * rect.height,
  };
  const halfWidth = ((column.width ?? 0.3) * gridSize) / 2;
  const halfDepth = ((column.height ?? 0.3) * gridSize) / 2;
  return [
    { x: centre.x - halfWidth, y: centre.y - halfDepth },
    { x: centre.x + halfWidth, y: centre.y - halfDepth },
    { x: centre.x + halfWidth, y: centre.y + halfDepth },
    { x: centre.x - halfWidth, y: centre.y + halfDepth },
  ];
};

/** The edges of a closed polygon, as point pairs. */
export const edgesOf = (polygon) =>
  polygon.map((point, index) => [point, polygon[(index + 1) % polygon.length]]);

const isFreeWall = (wall) => !wall.isBoundary && !wall.isCutPortion;

/**
 * @typedef {{ outline: object[], points: object[], lines: object[][], align: object[] }} FreeWallTargets
 */

/**
 * What a free wall in `roomId` is pulled to, from a canvas snapshot (with `gridSize`): the room's
 * outline; corners and ends (the room's corners, other free walls' corners and ends, columns'
 * corners) and lines (the room's faces, other free walls' sides, columns' sides) in the room;
 * corners and ends anywhere on the floor to line up with.
 * @param {object} view
 * @param {{ roomId: string, wallId?: string | null }} options `wallId`: the free wall being
 *   edited (its face), left out with its physical wall
 * @returns {FreeWallTargets}
 */
export function freeWallTargets(view, { roomId, wallId = null }) {
  const gridSize = view.gridSize || 20;
  const rooms = view.rooms || [];
  const walls = view.walls || [];
  const room = rooms.find((entry) => entry.id === roomId);
  const outline = room?.vertices || [];
  const own = walls.find((wall) => wall.id === wallId);
  const others = walls.filter(
    (wall) =>
      isFreeWall(wall) && wall.id !== wallId && (!own || wall.physicalWallId !== own.physicalWallId)
  );
  const body = (wall) =>
    (view.wallFootprints || []).find((entry) => entry.id === wall.physicalWallId)?.polygons || [];
  const columns = (view.columns || []).map((column) => ({
    roomId: column.roomId,
    corners: columnCorners(
      column,
      rooms.find((entry) => entry.id === column.roomId),
      gridSize
    ),
  }));
  const inRoom = others.filter((wall) => wall.roomId === roomId);
  const shapes = [
    outline,
    ...inRoom.flatMap(body),
    ...columns.filter((column) => column.roomId === roomId).map((column) => column.corners),
  ].filter((shape) => shape.length > 1);
  const ends = (wall) => (wall.points?.length ? [wall.points[0], wall.points.at(-1)] : []);
  return {
    outline,
    points: [...shapes.flat(), ...inRoom.flatMap(ends)],
    lines: shapes.flatMap(edgesOf),
    align: [
      ...rooms.flatMap((entry) => entry.vertices || []),
      ...others.flatMap(ends),
      ...columns.flatMap((column) => column.corners),
    ],
  };
}
