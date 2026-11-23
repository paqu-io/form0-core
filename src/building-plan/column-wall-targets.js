/**
 * What a column's room's walls offer it (`column-targets.js`, 2026-11-20), in canvas units: their
 * midlines and where they meet, for its centre, and where it may stand out of a wall.
 */

/** How far past a midline's end two midlines may meet (half a wall up to 1 m thick): metres. */
const JUNCTION_REACH_M = 0.5;

const segmentsOf = (points = []) => points.slice(1).map((point, index) => [points[index], point]);

/** Where the lines through two segments cross, or null when they are parallel. */
function crossingOf([a, b], [c, d]) {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denominator = r.x * s.y - r.y * s.x;
  if (Math.abs(denominator) <= 1e-12 * Math.hypot(r.x, r.y) * Math.hypot(s.x, s.y)) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denominator;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

/** Where `point` lies along segment `a`–`b` (`along`), how far past its ends, and how far off it. */
function placeOn(point, [a, b]) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!length) return { along: 0, past: Infinity, off: Infinity };
  const along = ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / length;
  const off = Math.abs(((point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x)) / length);
  return { along, past: along < 0 ? -along : along > length ? along - length : 0, off };
}

/** A segment carried on along its line to the `points` on that line past its ends. */
function carriedTo([a, b], points, reach) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!length) return [a, b];
  const tangent = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  let [from, to] = [0, length];
  for (const point of points) {
    const where = placeOn(point, [a, b]);
    if (where.off > 1e-6 || where.past > reach) continue;
    from = Math.min(from, where.along);
    to = Math.max(to, where.along);
  }
  return [
    { x: a.x + tangent.x * from, y: a.y + tangent.y * from },
    { x: a.x + tangent.x * to, y: a.y + tangent.y * to },
  ];
}

/**
 * Where wall midlines meet (corners, T-junctions, a free wall meeting a wall): the crossings of
 * their lines no further past either one's end than `JUNCTION_REACH_M`. Shared with the floor
 * below (`floor-below.js`, 2026-11-23).
 * @param {object[][]} midlines segments, canvas units
 * @param {number} gridSize canvas units a metre
 */
export function midlineJunctions(midlines, gridSize) {
  const reach = JUNCTION_REACH_M * (gridSize || 20);
  const junctions = [];
  for (let i = 0; i < midlines.length; i += 1)
    for (let j = i + 1; j < midlines.length; j += 1) {
      const point = crossingOf(midlines[i], midlines[j]);
      if (!point) continue;
      if (placeOn(point, midlines[i]).past > reach || placeOn(point, midlines[j]).past > reach)
        continue;
      if (!junctions.some((other) => Math.hypot(other.x - point.x, other.y - point.y) < 1e-6))
        junctions.push(point);
    }
  return junctions;
}

/** A room wall's interior faces, each with the side of it its body lies on (+1 or -1). */
function interiorFaces(ownWalls, footprints) {
  return ownWalls.flatMap((wall) => {
    const body = footprints.find((entry) => entry.id === wall.physicalWallId)?.polygons?.flat();
    return segmentsOf(wall.points).flatMap(([a, b]) => {
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (!length || !body?.length) return [];
      const offsets = body.map(
        (point) => ((point.y - a.y) * (b.x - a.x) - (point.x - a.x) * (b.y - a.y)) / length
      );
      const [low, high] = [Math.min(...offsets), Math.max(...offsets)];
      return [{ a, b, side: Math.abs(high) >= Math.abs(low) ? 1 : -1 }];
    });
  });
}

/**
 * @param {object} view the canvas snapshot, with `gridSize`
 * @param {string} roomId the column's room
 * @returns {{ midlines: object[][], junctions: object[], straddles: object[][],
 *   faces: Array<{ a: object, b: object, side: number }> }}
 *   `midlines`: the room's walls' and free walls' midlines; `junctions`: where they meet (corners,
 *   T-junctions, a free wall meeting a wall); `straddles`: the room's own walls' midlines carried on
 *   to those points (centred on one, a column may stand out of the wall on both sides);
 *   `faces`: the room's own walls' interior faces (in the wall, its room-side face flush with one,
 *   a column may stand out past the wall's exterior face)
 */
export function columnWallTargets(view, roomId) {
  const reach = JUNCTION_REACH_M * (view.gridSize || 20);
  const roomWalls = (view.walls || []).filter((wall) => wall.roomId === roomId);
  const ownWalls = roomWalls.filter((wall) => wall.isBoundary || wall.isCutPortion);
  const midlines = roomWalls.flatMap((wall) => segmentsOf(wall.axisPoints));
  const junctions = midlineJunctions(midlines, view.gridSize);
  return {
    midlines,
    junctions,
    straddles: ownWalls
      .flatMap((wall) => segmentsOf(wall.axisPoints))
      .map((segment) => carriedTo(segment, junctions, reach)),
    faces: interiorFaces(ownWalls, view.wallFootprints || []),
  };
}
