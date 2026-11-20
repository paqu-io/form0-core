import { columnCorners, edgesOf, freeWallTargets } from './free-wall-targets.js';

/**
 * What a column snaps to and where it may stand (`column-snapping.js`, unit 3 of the building plan
 * UI round, 2026-11-20), in canvas units, from the canvas snapshot.
 *
 * Against a wall a column sits flush inside (a side on the room face), centred on the wall's
 * midline, or flush with its far face, so it may stand in its room's own walls: its region is the
 * room's outline plus the bodies of the walls that bound the room (corner pieces included). Free
 * walls hold columns too: they are not in the way. Other columns, doors and windows are.
 */

/**
 * How far an opening's box reaches past its wall's faces: a column standing flush inside across
 * an opening overlaps it (it would block it), one beside it touching a jamb doesn't.
 */
const OPENING_REACH_M = 0.001;

const segmentsOf = (points = []) => points.slice(1).map((point, index) => [points[index], point]);

/** An opening's box across its wall, `reach` past both faces, from its axis and thickness. */
function openingBox(opening, gridSize, reach) {
  const [a, b] = [opening.points?.[0], opening.points?.at(-1)];
  const length = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
  if (!length) return opening.polygon || null;
  const half = ((opening.thickness ?? 0) * gridSize) / 2 + reach;
  const normal = { x: (-(b.y - a.y) / length) * half, y: ((b.x - a.x) / length) * half };
  return [
    { x: a.x + normal.x, y: a.y + normal.y },
    { x: b.x + normal.x, y: b.y + normal.y },
    { x: b.x - normal.x, y: b.y - normal.y },
    { x: a.x - normal.x, y: a.y - normal.y },
  ];
}

/**
 * @typedef {{
 *   region: object[][],
 *   centreRegion: object[],
 *   points: object[],
 *   lines: object[][],
 *   midlines: object[][],
 *   align: object[],
 *   centres: object[],
 *   rects: Array<{ minX: number, minY: number, maxX: number, maxY: number }>,
 *   boxes: object[][],
 * }} ColumnTargets
 */

/**
 * What a column in `roomId` is pulled to and kept clear of:
 * - `region`: the polygons it must stay inside (the room's outline, its walls' bodies);
 * - `centreRegion`: where its centre must be, core's rule for room elements today (`model.js`,
 *   `invalid_room_element`: inside the room's outline). Until core takes the region above as its
 *   rule for columns (4a, decided 2026-11-20), a column stands in a wall only as far as its centre
 *   stays in the room;
 * - `points` (corners) and `lines` (sides): the free wall targets in the room, plus its walls'
 *   bodies (far faces, ends, corner pieces) and the doors' and windows' boxes (jambs);
 * - `midlines`: the midlines of its room's walls and free walls, for its centre;
 * - `align` (corners and ends anywhere on the floor) and `centres` (other columns' centres), to
 *   line up with;
 * - `rects` (other columns) and `boxes` (openings, reaching just past their faces): what it may
 *   touch but not overlap.
 * @param {object} view the canvas snapshot, with `gridSize`
 * @param {{ roomId: string, columnId?: string | null }} options `columnId`: the column being moved
 * @returns {ColumnTargets}
 */
export function columnTargets(view, { roomId, columnId = null }) {
  const gridSize = view.gridSize || 20;
  const base = freeWallTargets(view, { roomId, columnId });
  const rooms = view.rooms || [];
  const bodies = (view.wallFootprints || [])
    .filter((entry) => (entry.roomIds || []).includes(roomId))
    .flatMap((entry) => entry.polygons || [])
    .filter((polygon) => polygon.length > 2);
  const openings = view.physicalOpenings || [];
  const others = (view.columns || []).filter(
    (column) => columnId == null || column.id !== columnId
  );
  const corners = others.map((column) =>
    columnCorners(
      column,
      rooms.find((room) => room.id === column.roomId),
      gridSize
    )
  );
  const jambs = openings.map((opening) => opening.polygon || []).filter((box) => box.length > 2);
  return {
    region: [base.outline, ...bodies].filter((polygon) => polygon.length > 2),
    points: [...base.points, ...bodies.flat(), ...jambs.flat()],
    centreRegion: base.outline,
    lines: [...base.lines, ...bodies.flatMap(edgesOf), ...jambs.flatMap(edgesOf)],
    midlines: (view.walls || [])
      .filter((wall) => wall.roomId === roomId)
      .flatMap((wall) => segmentsOf(wall.axisPoints)),
    align: base.align,
    centres: corners
      .filter((points) => points.length === 4)
      .map(([a, , c]) => ({ x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 })),
    rects: corners
      .filter((points) => points.length === 4)
      .map(([a, , c]) => ({ minX: a.x, minY: a.y, maxX: c.x, maxY: c.y })),
    boxes: openings
      .map((opening) => openingBox(opening, gridSize, OPENING_REACH_M * gridSize))
      .filter(Boolean),
  };
}
