import { columnCorners, edgesOf, freeWallTargets } from './free-wall-targets.js';
import { columnWallTargets } from './column-wall-targets.js';
import { beamEnds } from './beam-targets.js';

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
 *   points: object[],
 *   lines: object[][],
 *   midlines: object[][],
 *   straddles: object[][],
 *   junctions: object[],
 *   beamEnds: object[],
 *   faces: Array<{ a: object, b: object, side: number }>,
 *   align: object[],
 *   centres: object[],
 *   rects: Array<{ minX: number, minY: number, maxX: number, maxY: number, id?: string }>,
 *   boxes: object[][],
 *   boxIds: Array<string | undefined>,
 * }} ColumnTargets
 */

/**
 * What a column in `roomId` is pulled to and kept clear of:
 * - `region`: the polygons it must stay inside (the room's outline, its walls' bodies);
 * - `points` (corners) and `lines` (sides): the free wall targets in the room, plus its walls'
 *   bodies (far faces, ends, corner pieces) and the doors' and windows' boxes (jambs);
 * - `midlines` and `junctions` (where midlines meet: corners, T-junctions), for its centre; the
 *   beams in its room too (3a, asked at the 3a-1 hand test): their centrelines with the midlines,
 *   their ends (`beamEnds`) for its centre to stand under;
 *   `straddles` (centred on one of the room's walls, it may stand out of it on both sides) and
 *   `faces` (in a wall with its room-side face flush with the wall's interior face, it may stand
 *   out past the exterior face): `column-wall-targets.js`;
 * - `align` (corners and ends anywhere on the floor) and `centres` (other columns' centres), to
 *   line up with;
 * - `rects` (other columns, with their ids) and `boxes` (openings, reaching just past their faces;
 *   their ids in `boxIds`): what it may touch but not overlap.
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
  const placed = others
    .map((column) => ({
      id: column.id,
      corners: columnCorners(
        column,
        rooms.find((room) => room.id === column.roomId),
        gridSize
      ),
    }))
    .filter((column) => column.corners.length === 4);
  const boxed = openings
    .map((opening) => ({
      id: opening.id,
      box: openingBox(opening, gridSize, OPENING_REACH_M * gridSize),
    }))
    .filter((opening) => opening.box);
  const jambs = openings.map((opening) => opening.polygon || []).filter((box) => box.length > 2);
  const walls = columnWallTargets(view, roomId);
  const beams = (view.beams || [])
    .filter((beam) => beam.roomId === roomId)
    .map((beam) =>
      beamEnds(
        beam,
        rooms.find((room) => room.id === roomId)
      )
    )
    .filter((ends) => ends.length === 2);
  return {
    region: [base.outline, ...bodies].filter((polygon) => polygon.length > 2),
    points: [...base.points, ...bodies.flat(), ...jambs.flat()],
    lines: [...base.lines, ...bodies.flatMap(edgesOf), ...jambs.flatMap(edgesOf)],
    ...walls,
    midlines: [...walls.midlines, ...beams],
    beamEnds: beams.flat(),
    align: base.align,
    centres: placed.map(({ corners: [a, , c] }) => ({ x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 })),
    rects: placed.map(({ id, corners: [a, , c] }) => ({
      minX: a.x,
      minY: a.y,
      maxX: c.x,
      maxY: c.y,
      id,
    })),
    boxes: boxed.map((opening) => opening.box),
    boxIds: boxed.map((opening) => opening.id),
  };
}
