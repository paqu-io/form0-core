/**
 * Grid and position-based predicates for the derived BuildingPlan core.
 * Coordinates are metres, rounded to a 0.1 mm grid. Lines are compared by the offsets of their
 * endpoints, never by unit directions, so short edges and rotated plans behave alike.
 */

export const GRID = 1e-4;
/**
 * One tolerance for every comparison. Rounding a point to the grid moves it by up to
 * GRID·√2/2, so on a diagonal the offset of one point can drift by 0.71 GRID and a distance or
 * offset difference between two points by 1.42 GRID. 1.5 GRID (0.15 mm) covers that.
 */
export const TOLERANCE = GRID * 1.5;
export const SAME = TOLERANCE;
export const GAP_TOLERANCE = TOLERANCE;

export const toGrid = (value) => Math.round(value * 1e4) / 1e4 + 0;
export const gridPoint = (point) => ({ ...point, x: toGrid(point.x), y: toGrid(point.y) });

export function lineFrame(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= SAME) return null;
  const tangent = { x: dx / length, y: dy / length };
  return { start, end, length, tangent, normal: { x: -tangent.y, y: tangent.x } };
}

export function along(frame, point) {
  return (point.x - frame.start.x) * frame.tangent.x + (point.y - frame.start.y) * frame.tangent.y;
}

export function offset(frame, point) {
  return (point.x - frame.start.x) * frame.normal.x + (point.y - frame.start.y) * frame.normal.y;
}

export function pointAt(frame, station, distance = 0) {
  return {
    x: frame.start.x + frame.tangent.x * station + frame.normal.x * distance,
    y: frame.start.y + frame.tangent.y * station + frame.normal.y * distance,
  };
}

/** Both endpoints of a segment lie on the frame's line. */
export function liesOnLine(frame, start, end, tolerance = SAME) {
  return Math.abs(offset(frame, start)) <= tolerance && Math.abs(offset(frame, end)) <= tolerance;
}

/** The segment runs parallel to the frame: its endpoints have the same offset. */
export function parallelTo(frame, start, end, tolerance = GAP_TOLERANCE) {
  return Math.abs(offset(frame, start) - offset(frame, end)) <= tolerance;
}

/** Overlap of two station intervals, or null when shorter than the tolerance. */
export function overlap(a, b, tolerance = SAME) {
  const from = Math.max(Math.min(...a), Math.min(...b));
  const to = Math.min(Math.max(...a), Math.max(...b));
  return to - from > tolerance ? [from, to] : null;
}

export const sameStation = (a, b) => Math.abs(a - b) <= SAME;

/** Sorted, de-duplicated stations within [from, to]. */
export function stationsWithin(values, from, to) {
  return [from, to, ...values.filter((value) => value > from + SAME && value < to - SAME)]
    .sort((a, b) => a - b)
    .filter((value, index, list) => !index || value - list[index - 1] > SAME);
}
