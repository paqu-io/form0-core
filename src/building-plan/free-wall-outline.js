import {
  GEOMETRY_EPSILON as EPS,
  cross,
  distance,
  pointInPolygon,
  pointOnSegment,
  subtract,
} from './geometry.js';
import { edgesOf } from './free-wall-targets.js';

/**
 * A free wall's end against its room's outline (moved from `free-wall-snapping.js`, 2026-11-23):
 * where an end stops when it would leave the room, and the nearest pick and segment point the
 * snapping shares.
 */

/** The candidate with the smallest `error`; the first of equals. */
export const nearest = (candidates) =>
  candidates.reduce((best, entry) => (!best || entry.error < best.error ? entry : best), null);

/** The point of segment `a`–`b` nearest to `point`. */
export function closestOnSegment(point, a, b) {
  const span = subtract(b, a);
  const lengthSquared = span.x * span.x + span.y * span.y;
  const t =
    lengthSquared <= EPS
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - a.x) * span.x + (point.y - a.y) * span.y) / lengthSquared)
        );
  return { x: a.x + span.x * t, y: a.y + span.y * t };
}

/** The first point where `from`→`to` leaves `outline`, or `to` when it stays inside. */
export function keepInside(to, from, outline) {
  if (outline.length < 3 || pointInPolygon(to, outline, true)) return to;
  if (from && pointInPolygon(from, outline, true)) {
    const path = subtract(to, from);
    let first = 1;
    for (const [a, b] of edgesOf(outline)) {
      const edge = subtract(b, a);
      const denominator = cross(path, edge);
      if (Math.abs(denominator) <= EPS) continue;
      const t = cross(subtract(a, from), edge) / denominator;
      const u = cross(subtract(a, from), path) / denominator;
      if (t > EPS && t < first && u >= -EPS && u <= 1 + EPS) first = t;
    }
    return { x: from.x + path.x * first, y: from.y + path.y * first };
  }
  return nearest(
    edgesOf(outline).map(([a, b]) => {
      const point = closestOnSegment(to, a, b);
      return { point, error: distance(point, to) };
    })
  ).point;
}

/**
 * An end stopped on the room's outline, moved along the face it stopped on to the 1 cm step when
 * that keeps it on the face (a horizontal or vertical one).
 */
export function onStep(point, outline, round) {
  const edges = edgesOf(outline);
  for (const candidate of [
    { x: point.x, y: round(point.y) },
    { x: round(point.x), y: point.y },
  ])
    if (edges.some(([a, b]) => pointOnSegment(candidate, a, b))) return candidate;
  return point;
}
