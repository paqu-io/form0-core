import { GEOMETRY_EPSILON as EPS, cross, dot, pointInPolygon, polygonArea } from './geometry.js';
import { buildingPlanSegmentThickness } from './model.js';

/**
 * A free wall's body (4a-3b, 2026-11-20): a band around its centreline, half its thickness each
 * side. An end lying on its room's outline, or on another free wall's side, is cut along that line
 * (along both faces in a convex corner) instead of square, so a diagonal wall meets the face with
 * nothing past it and no gap. The body stays inside its room (touching allowed): the room contents
 * check, the drawing and the snapping read it from here. Pure functions in any one unit; `touch`
 * is how near counts as on (0.1 mm in metres).
 */

/** Within this distance (metres) a point counts as on a line (as columns touch, 0.1 mm). */
export const TOUCH_M = 1e-4;
// An end within ten times that (1 mm) of a face or side meets it and is cut along it: a stored
// end can sit a hair off the face it was put on (after the 4a-3b hand test).
export const CUT_REACH = 10;
// A line within 5° of the wall's direction doesn't cut its end (the cut would run along it).
export const MIN_SIN = Math.sin((5 * Math.PI) / 180);

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const unit = (v) => {
  const size = Math.hypot(v.x, v.y);
  return size > EPS ? { x: v.x / size, y: v.y / size } : null;
};
const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Whether `point` lies on segment `a`–`b`, within `touch`. */
function onSegment(point, a, b, touch) {
  const tangent = unit(sub(b, a));
  if (!tangent) return gap(point, a) <= touch;
  const along = dot(sub(point, a), tangent);
  return (
    along >= -touch &&
    along <= gap(a, b) + touch &&
    Math.abs(cross(tangent, sub(point, a))) <= touch
  );
}

/** Whether `point` lies on `outline`, within `touch`. */
export const onOutline = (point, outline, touch = TOUCH_M) =>
  outline.some((a, index) => onSegment(point, a, outline[(index + 1) % outline.length], touch));

/** Whether `point` lies inside `outline` or within `touch` of it. */
export function inOrOn(point, outline, touch = TOUCH_M) {
  if (pointInPolygon(point, outline, true)) return true;
  return outline.some((a, index) =>
    onSegment(point, a, outline[(index + 1) % outline.length], touch)
  );
}

/**
 * Whether segment `a`–`b` lies inside the outline, touching allowed: cut where it meets the
 * outline's edges and passes its corners, every piece lies on one side of the outline, so its
 * middle tells (an L-shaped room's notch is caught even with both ends inside).
 */
export function segmentInside(a, b, outline, touch = TOUCH_M) {
  if (!inOrOn(a, outline, touch) || !inOrOn(b, outline, touch)) return false;
  const span = sub(b, a);
  const lengthSquared = dot(span, span);
  if (lengthSquared <= EPS * EPS) return true;
  const cuts = [0, 1];
  outline.forEach((start, index) => {
    const edge = sub(outline[(index + 1) % outline.length], start);
    const offset = sub(start, a);
    const denominator = cross(span, edge);
    if (Math.abs(denominator) > EPS) {
      const u = cross(offset, span) / denominator;
      if (u >= 0 && u <= 1) cuts.push(cross(offset, edge) / denominator);
    }
    cuts.push(dot(offset, span) / lengthSquared);
  });
  const sorted = cuts.filter((t) => t >= 0 && t <= 1).sort((p, q) => p - q);
  return sorted.every((t, index) => {
    if (!index || t - sorted[index - 1] <= EPS) return true;
    const middle = (t + sorted[index - 1]) / 2;
    return inOrOn({ x: a.x + span.x * middle, y: a.y + span.y * middle }, outline, touch);
  });
}

/** Whether a polygon lies inside the outline (its edges do), touching allowed. */
export const polygonInside = (polygon, outline, touch = TOUCH_M) =>
  polygon.every((point, index) =>
    segmentInside(point, polygon[(index + 1) % polygon.length], outline, touch)
  );

/**
 * The outline's edges an end lying on it is cut along: the edge it lies on; at a convex corner,
 * both; at a reflex corner none (the end stays square).
 */
export function outlineCuts(point, outline, touch = TOUCH_M) {
  const count = outline.length;
  const sign = Math.sign(polygonArea(outline));
  for (let index = 0; index < count; index += 1) {
    const corner = outline[index];
    if (gap(point, corner) > touch) continue;
    const [before, after] = [outline[(index + count - 1) % count], outline[(index + 1) % count]];
    return sign * cross(sub(corner, before), sub(after, corner)) > EPS
      ? [
          [before, corner],
          [corner, after],
        ]
      : [];
  }
  for (let index = 0; index < count; index += 1) {
    const [a, b] = [outline[index], outline[(index + 1) % count]];
    if (onSegment(point, a, b, touch)) return [[a, b]];
  }
  return [];
}

/** `polygon` clipped to the side of line `a`–`b` that holds `inside`. */
function keepSide(polygon, a, b, inside) {
  const direction = sub(b, a);
  const sign = Math.sign(cross(direction, sub(inside, a))) || 1;
  const value = (point) => sign * cross(direction, sub(point, a));
  const result = [];
  polygon.forEach((p, index) => {
    const q = polygon[(index + 1) % polygon.length];
    const [vp, vq] = [value(p), value(q)];
    if (vp >= 0) result.push(p);
    if ((vp < 0 && vq > 0) || (vp > 0 && vq < 0)) {
      const t = vp / (vp - vq);
      result.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  });
  return result;
}

/**
 * The band of half-width `half` around `start`–`end`, each end cut along its lines (`[a, b]`
 * pairs) where they cross it, else square. Empty for a point or no width.
 */
export function cutBand(start, end, half, [startCuts = [], endCuts = []] = []) {
  const tangent = unit(sub(end, start));
  if (!tangent || !(half > 0)) return [];
  const sines = (lines) =>
    lines
      .map(([a, b]) => ({
        line: [a, b],
        sin: Math.abs(cross(tangent, unit(sub(b, a)) || tangent)),
      }))
      .filter((entry) => entry.sin >= MIN_SIN);
  const [atStart, atEnd] = [sines(startCuts), sines(endCuts)];
  const reach = (entries) =>
    entries.length ? half / Math.min(...entries.map((entry) => entry.sin)) + half : 0;
  const normal = { x: -tangent.y, y: tangent.x };
  const point = (along, offset) => ({
    x: start.x + tangent.x * along + normal.x * offset,
    y: start.y + tangent.y * along + normal.y * offset,
  });
  const [from, to] = [-reach(atStart), gap(start, end) + reach(atEnd)];
  let polygon = [point(from, half), point(to, half), point(to, -half), point(from, -half)];
  const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  for (const { line } of [...atStart, ...atEnd]) polygon = keepSide(polygon, ...line, middle);
  return polygon.length >= 3 ? polygon : [];
}

/**
 * Whether a free wall along `points` (its centreline) fits its room's `outline`: the centreline
 * inside, and its body, its ends cut along the faces they stop on.
 */
export function freeWallFits(points, half, outline, touch = TOUCH_M) {
  if (!(outline?.length >= 3)) return true;
  if (
    !points.every(
      (point, index) => !index || segmentInside(points[index - 1], point, outline, touch)
    )
  )
    return false;
  if (!(half > 0)) return true;
  const last = points.length - 2;
  return points.slice(1).every((end, index) => {
    const start = points[index];
    const band = cutBand(start, end, half, [
      index === 0 ? outlineCuts(start, outline, touch * CUT_REACH) : [],
      index === last ? outlineCuts(end, outline, touch * CUT_REACH) : [],
    ]);
    return !band.length || polygonInside(band, outline, touch);
  });
}

/** The two side lines of a band around `start`–`end` (as `[a, b]` pairs). */
function sideLines(start, end, half) {
  const tangent = unit(sub(end, start));
  if (!tangent) return [];
  const normal = { x: -tangent.y, y: tangent.x };
  return [half, -half].map((offset) => [
    { x: start.x + normal.x * offset, y: start.y + normal.y * offset },
    { x: end.x + normal.x * offset, y: end.y + normal.y * offset },
  ]);
}

/**
 * The bodies of a floor's free walls, by `${wallId}:${segmentId}`, in metres: each segment's band,
 * an end that meets no other free wall's end cut along the room's outline it lies on, else along
 * another free wall's side it lies on.
 * @param {object} floor the stored floor
 * @returns {Map<string, Array<{ x: number, y: number }>>}
 */
export function freeWallSegmentBodies(floor, touch = TOUCH_M) {
  const bodies = new Map();
  for (const room of floor.rooms || []) {
    const runs = [];
    for (const face of room.faces || []) {
      if (!face.freePath) continue;
      const wall = (floor.walls || []).find((entry) => entry.id === face.wallId);
      for (const segment of wall?.segments || []) {
        const thickness = buildingPlanSegmentThickness(wall, segment);
        if (thickness > 0 && !runs.some((run) => run.segment === segment))
          runs.push({ wall, segment, half: thickness / 2 });
      }
    }
    const ends = runs.flatMap((run) =>
      [run.segment.start, run.segment.end].map((p) => ({ run, p }))
    );
    const cutsAt = (run, point) => {
      if (ends.some((other) => other.run !== run && gap(other.p, point) <= touch)) return [];
      const onFace = outlineCuts(point, room.vertices || [], touch * CUT_REACH);
      if (onFace.length) return onFace;
      const side = runs
        .filter((other) => other !== run)
        .flatMap((other) => sideLines(other.segment.start, other.segment.end, other.half))
        .find(([a, b]) => onSegment(point, a, b, touch * CUT_REACH));
      return side ? [side] : [];
    };
    for (const run of runs) {
      const { start, end } = run.segment;
      const polygon = cutBand(start, end, run.half, [cutsAt(run, start), cutsAt(run, end)]);
      if (polygon.length) bodies.set(`${run.wall.id}:${run.segment.id}`, polygon);
    }
  }
  return bodies;
}
