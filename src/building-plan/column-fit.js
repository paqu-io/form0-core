import { cross, distance, dot, subtract } from './geometry.js';
import { edgesOf } from './free-wall-targets.js';

/**
 * Where a column fits (`column-snapping.js`): inside its region (the room and its own walls) and
 * clear of other columns and of openings, which it may touch. Canvas units; pure functions.
 */

/**
 * Closer than this, two sides touch (a tenth of a millimetre): above the canvas's rounding of
 * points (3 decimals of a canvas unit), so a column snapped against another, or beside a jamb,
 * isn't refused for a rounding difference.
 */
export const COLUMN_TOUCH_M = 1e-4;

/** @typedef {{ minX: number, minY: number, maxX: number, maxY: number }} Rect */

/** @returns {Rect} */
export const columnRect = (centre, half) => ({
  minX: centre.x - half.x,
  minY: centre.y - half.y,
  maxX: centre.x + half.x,
  maxY: centre.y + half.y,
});

export const rectCorners = (rect) => [
  { x: rect.minX, y: rect.minY },
  { x: rect.maxX, y: rect.minY },
  { x: rect.maxX, y: rect.maxY },
  { x: rect.minX, y: rect.maxY },
];

function nearSegment(point, a, b, tolerance) {
  const span = subtract(b, a);
  const squared = dot(span, span);
  const t = squared ? Math.max(0, Math.min(1, dot(subtract(point, a), span) / squared)) : 0;
  return distance(point, { x: a.x + span.x * t, y: a.y + span.y * t }) <= tolerance;
}

/** Inside `polygon` or within `tolerance` of its outline. */
function inPolygon(point, polygon, tolerance) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j];
    const b = polygon[i];
    if (nearSegment(point, a, b, tolerance)) return true;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

const inRegion = (point, region, tolerance) =>
  region.some((polygon) => inPolygon(point, polygon, tolerance));

/**
 * Whether segment `p`–`q` lies inside the region: cut where it meets the polygons' edges, each
 * piece's middle must be inside one of them.
 */
function segmentInside(p, q, region, tolerance) {
  const path = subtract(q, p);
  const squared = dot(path, path);
  const cuts = [0, 1];
  for (const polygon of region)
    for (const [a, b] of edgesOf(polygon)) {
      const edge = subtract(b, a);
      const offset = subtract(a, p);
      const denominator = cross(path, edge);
      if (Math.abs(denominator) > 1e-12 * Math.sqrt(squared * dot(edge, edge))) {
        const t = cross(offset, edge) / denominator;
        const u = cross(offset, path) / denominator;
        if (t > 0 && t < 1 && u >= -1e-9 && u <= 1 + 1e-9) cuts.push(t);
      } else if (Math.abs(cross(offset, path)) <= tolerance * Math.sqrt(squared))
        // Along the same line: its ends cut the segment.
        for (const point of [a, b]) {
          const t = dot(subtract(point, p), path) / squared;
          if (t > 0 && t < 1) cuts.push(t);
        }
    }
  cuts.sort((x, y) => x - y);
  for (let i = 1; i < cuts.length; i += 1) {
    if (cuts[i] - cuts[i - 1] <= 1e-9) continue;
    const t = (cuts[i] + cuts[i - 1]) / 2;
    if (!inRegion({ x: p.x + path.x * t, y: p.y + path.y * t }, region, tolerance)) return false;
  }
  return inRegion(p, region, tolerance) && inRegion(q, region, tolerance);
}

/**
 * A rectangle inside the region. The region (a room and the walls around it) has no holes, so
 * the rectangle is inside when its outline is.
 */
function rectInside(rect, region, tolerance) {
  const corners = rectCorners(rect);
  return corners.every((corner, index) =>
    segmentInside(corner, corners[(index + 1) % 4], region, tolerance)
  );
}

const rectsOverlap = (a, b, tolerance) =>
  Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > tolerance &&
  Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) > tolerance;

/** A rectangle and a convex polygon overlapping by more than `tolerance` (separating axes). */
function overlapsPolygon(rect, polygon, tolerance) {
  const corners = rectCorners(rect);
  const axes = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    ...edgesOf(polygon).map(([a, b]) => ({ x: a.y - b.y, y: b.x - a.x })),
  ];
  return axes.every((axis) => {
    const size = Math.hypot(axis.x, axis.y);
    if (!size) return true;
    const along = (point) => (point.x * axis.x + point.y * axis.y) / size;
    const own = corners.map(along);
    const other = polygon.map(along);
    return (
      Math.min(Math.max(...own), Math.max(...other)) -
        Math.max(Math.min(...own), Math.min(...other)) >
      tolerance
    );
  });
}

/**
 * Whether a column centred at `centre` (`half` its half sizes) fits: its centre where core wants
 * it, inside the region, clear of other columns and of openings.
 * @param {{ x: number, y: number }} centre
 * @param {{ x: number, y: number }} half
 * @param {import('./column-targets.js').ColumnTargets} targets
 * @param {number} gridSize
 */
export function columnFits(centre, half, targets, gridSize) {
  const tolerance = COLUMN_TOUCH_M * gridSize;
  // Core's rule today: the centre in the room (to its own precision, a micrometre).
  if (targets.centreRegion?.length > 2 && !inPolygon(centre, targets.centreRegion, 1e-6 * gridSize))
    return false;
  const rect = columnRect(centre, half);
  if (targets.region.length && !rectInside(rect, targets.region, tolerance)) return false;
  if (targets.rects.some((other) => rectsOverlap(rect, other, tolerance))) return false;
  return !targets.boxes.some((box) => overlapsPolygon(rect, box, tolerance));
}

/** The farthest point from `from` (which fits) towards `to` that still fits. */
function reach(from, to, fits) {
  let low = 0;
  let high = 1;
  for (let i = 0; i < 24; i += 1) {
    const middle = (low + high) / 2;
    if (fits({ x: from.x + (to.x - from.x) * middle, y: from.y + (to.y - from.y) * middle }))
      low = middle;
    else high = middle;
  }
  return { x: from.x + (to.x - from.x) * low, y: from.y + (to.y - from.y) * low };
}

/**
 * Where a dragged column stops on its way from `from` (which fits) to `to`: as far as it goes,
 * then sliding along what stopped it, on whichever axis gets nearer to `to`.
 */
export function slideColumn(from, to, fits) {
  if (fits(to)) return to;
  const stopped = reach(from, to, fits);
  const routes = [
    reach(reach(stopped, { x: to.x, y: stopped.y }, fits), to, fits),
    reach(reach(stopped, { x: stopped.x, y: to.y }, fits), to, fits),
  ];
  return routes.reduce((best, point) => (distance(point, to) < distance(best, to) ? point : best));
}

/**
 * The nearest place to `centre` where a column fits, with no drag to come from (placing): first
 * flush against the lines near it, then on a widening ring of steps. Null when there is none
 * within `radius`.
 * @param {{ x: number, y: number }} centre
 * @param {{ x: number, y: number }} half
 * @param {import('./column-targets.js').ColumnTargets} targets
 * @param {(centre: object) => boolean} fits
 * @param {{ step: number, radius: number }} options canvas units
 */
export function nearestColumnFit(centre, half, targets, fits, { step, radius }) {
  if (fits(centre)) return centre;
  const values = (axis, extent) => {
    const list = [centre[axis]];
    for (const [a, b] of targets.lines)
      if (Math.abs(a[axis] - b[axis]) <= 1e-9 && Math.abs(a[axis] - centre[axis]) <= radius)
        list.push(a[axis] - extent, a[axis] + extent);
    return [...new Set(list)];
  };
  const flush = values('x', half.x)
    .flatMap((x) => values('y', half.y).map((y) => ({ x, y })))
    .sort((a, b) => distance(a, centre) - distance(b, centre));
  const found = flush.slice(0, 600).find(fits);
  if (found) return found;
  for (let ring = 1; ring * step * 5 <= radius; ring += 1) {
    const offset = ring * step * 5;
    for (let k = -ring; k <= ring; k += 1)
      for (const point of [
        { x: centre.x + k * step * 5, y: centre.y - offset },
        { x: centre.x + k * step * 5, y: centre.y + offset },
        { x: centre.x - offset, y: centre.y + k * step * 5 },
        { x: centre.x + offset, y: centre.y + k * step * 5 },
      ])
        if (fits(point)) return point;
  }
  return null;
}
