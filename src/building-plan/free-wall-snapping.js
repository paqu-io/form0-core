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
 * Snapping for free walls, the walls that stand in a room (2026-11-19, web UI round). A free
 * wall's end, being drawn or dragged, and a whole free wall being moved:
 *
 * - an end locks horizontal or vertical with the other end when it is within reach of either;
 *   on a locked line the end slides along it, so a corner off the line never bends the wall;
 * - pulls, in order: a corner or end (the room's corners, other free walls' corners and ends,
 *   columns' corners), a line (the room's faces, other free walls' sides, columns' sides), lining
 *   up with corners and ends anywhere on the floor (a dashed guide), else the 1 cm step;
 * - a free wall never leaves its room: an end stops on the room's outline, a moved wall stops
 *   where it would leave it.
 *
 * Pure functions in canvas units; the interaction helper holds what was caught between calls
 * (`tolerance(key)` is larger for a key it holds) and shows the guides.
 */

/** One centimetre in metres: the step a position takes when nothing pulls it. */
const STEP_M = 0.01;

const nearest = (candidates) =>
  candidates.reduce((best, entry) => (!best || entry.error < best.error ? entry : best), null);

/** The point of segment `a`–`b` nearest to `point`. */
function closestOnSegment(point, a, b) {
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

/** Where a locked line (`fixed` held at `value`) crosses segment `a`–`b`, as the free coordinate. */
function crossing(a, b, fixed, value) {
  const free = fixed === 'y' ? 'x' : 'y';
  if ((a[fixed] - value) * (b[fixed] - value) > 0 || Math.abs(a[fixed] - b[fixed]) <= EPS)
    return null;
  return a[free] + ((value - a[fixed]) * (b[free] - a[free])) / (b[fixed] - a[fixed]);
}

/** Lines up `point` on `axis` with the nearest target within reach (a guide joins them). */
function lineUp(point, axis, align, tolerance) {
  const entry = nearest(
    align
      .map((target, index) => ({
        target,
        key: `align:${axis}:${index}`,
        error: Math.abs(target[axis] - point[axis]),
      }))
      .filter((entry) => entry.error <= tolerance(entry.key))
  );
  return entry;
}

/** The first point where `from`→`to` leaves `outline`, or `to` when it stays inside. */
function keepInside(to, from, outline) {
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
function onStep(point, outline, round) {
  const edges = edgesOf(outline);
  for (const candidate of [
    { x: point.x, y: round(point.y) },
    { x: round(point.x), y: point.y },
  ])
    if (edges.some(([a, b]) => pointOnSegment(candidate, a, b))) return candidate;
  return point;
}

/**
 * Snaps an end of a free wall being drawn or dragged.
 * @param {{ x: number, y: number }} point
 * @param {{
 *   from?: { x: number, y: number } | null,
 *   targets: import('./free-wall-targets.js').FreeWallTargets,
 *   gridSize: number,
 *   tolerance: (key: string) => number,
 *   free?: boolean,
 * }} options `from`: the other end (none for the first point of a drawing); `free`: no pulls
 *   (Alt, or snapping off): only the 1 cm step and the room
 * @returns {{ point: { x: number, y: number }, guides: object[], keys: string[] }}
 */
export function snapFreeWallEnd(
  point,
  { from = null, targets, gridSize, tolerance, free = false }
) {
  const step = STEP_M * gridSize;
  const round = (value) => Math.round(value / step) * step;
  const guides = [];
  const keys = [];
  let result = { x: round(point.x), y: round(point.y) };
  const dx = from ? point.x - from.x : 0;
  const dy = from ? point.y - from.y : 0;
  const axis = free
    ? null
    : from && Math.abs(dx) >= Math.abs(dy) && Math.abs(dy) <= tolerance('lock:y')
      ? 'y'
      : from && Math.abs(dy) > Math.abs(dx) && Math.abs(dx) <= tolerance('lock:x')
        ? 'x'
        : null;
  if (axis) {
    // Locked: `axis` keeps the other end's value; the end slides along the line.
    const along = axis === 'y' ? 'x' : 'y';
    keys.push(`lock:${axis}`);
    result = { [axis]: from[axis], [along]: point[along] };
    const hit = nearest(
      targets.lines.flatMap(([a, b], index) => {
        const value = crossing(a, b, axis, from[axis]);
        if (value == null) return [];
        const key = `line:${index}`;
        const error = Math.abs(value - point[along]);
        return error <= tolerance(key) ? [{ value, key, error }] : [];
      })
    );
    const lined = hit ? null : lineUp(result, along, targets.align, tolerance);
    if (hit) {
      result[along] = hit.value;
      keys.push(hit.key);
    } else if (lined) {
      result[along] = lined.target[along];
      keys.push(lined.key);
      guides.push({ from: { ...lined.target }, to: { ...result } });
    } else result[along] = round(result[along]);
    guides.push({ from: { ...from }, to: { ...result } });
  } else if (!free) {
    const corner = nearest(
      targets.points
        .map((target, index) => ({ target, key: `point:${index}`, error: distance(target, point) }))
        .filter((entry) => entry.error <= tolerance(entry.key))
    );
    const line = corner
      ? null
      : nearest(
          targets.lines
            .map(([a, b], index) => {
              const target = closestOnSegment(point, a, b);
              return { target, key: `line:${index}`, error: distance(target, point) };
            })
            .filter((entry) => entry.error <= tolerance(entry.key))
        );
    if (corner || line) {
      result = { ...(corner || line).target };
      keys.push((corner || line).key);
    } else
      for (const coordinate of ['x', 'y']) {
        const lined = lineUp(point, coordinate, targets.align, tolerance);
        if (!lined) continue;
        result[coordinate] = lined.target[coordinate];
        keys.push(lined.key);
        guides.push({ from: { ...lined.target }, to: result });
      }
  }
  const kept = keepInside(result, from, targets.outline);
  return { point: kept === result ? result : onStep(kept, targets.outline, round), guides, keys };
}

const samples = (path) =>
  path.flatMap((point, index) =>
    index
      ? [0.25, 0.5, 0.75, 1].map((t) => ({
          x: path[index - 1].x + (point.x - path[index - 1].x) * t,
          y: path[index - 1].y + (point.y - path[index - 1].y) * t,
        }))
      : [point]
  );

/**
 * Snaps a whole free wall being moved: it keeps its direction; an end meets a corner or end,
 * else a line, else its ends line up with corners and ends, else its first end takes the 1 cm
 * step; then it is held inside the room, stopping where it would leave it.
 * @param {Array<{ x: number, y: number }>} points the moved path
 * @param {{
 *   originalPoints: Array<{ x: number, y: number }>,
 *   targets: import('./free-wall-targets.js').FreeWallTargets,
 *   gridSize: number,
 *   tolerance: (key: string) => number,
 *   free?: boolean,
 * }} options
 * @returns {{ points: Array<{ x: number, y: number }>, guides: object[], keys: string[] }}
 */
export function snapFreeWallTranslation(
  points,
  { originalPoints, targets, gridSize, tolerance, free = false }
) {
  const step = STEP_M * gridSize;
  const ends = [points[0], points.at(-1)];
  const guides = [];
  const keys = [];
  let delta = null;
  if (!free) {
    const contact = (kind, list) =>
      nearest(
        ends
          .flatMap((end) =>
            list.map((target, index) => {
              const point = kind === 'point' ? target : closestOnSegment(end, ...target);
              return {
                key: `${kind}:${index}`,
                error: distance(point, end),
                delta: subtract(point, end),
              };
            })
          )
          .filter((entry) => entry.error <= tolerance(entry.key))
      );
    const hit = contact('point', targets.points) || contact('line', targets.lines);
    if (hit) {
      delta = hit.delta;
      keys.push(hit.key);
    }
  }
  if (!delta) {
    delta = { x: null, y: null };
    for (const coordinate of free ? [] : ['x', 'y']) {
      const lined = nearest(
        ends
          .map((end) => ({ end, entry: lineUp(end, coordinate, targets.align, tolerance) }))
          .filter(({ entry }) => entry)
          .map(({ end, entry }) => ({ ...entry, end }))
      );
      if (!lined) continue;
      delta[coordinate] = lined.target[coordinate] - lined.end[coordinate];
      keys.push(lined.key);
      guides.push({
        from: { ...lined.target },
        to: { ...lined.end, [coordinate]: lined.target[coordinate] },
      });
    }
    for (const coordinate of ['x', 'y'])
      delta[coordinate] ??= Math.round(ends[0][coordinate] / step) * step - ends[0][coordinate];
  }
  let moved = points.map((point) => ({ ...point, x: point.x + delta.x, y: point.y + delta.y }));
  const inside = (path) =>
    samples(path).every((point) => pointInPolygon(point, targets.outline, true));
  if (targets.outline.length >= 3 && !inside(moved) && inside(originalPoints)) {
    // As far as it goes towards the pointer while it stays in the room.
    const shift = subtract(moved[0], originalPoints[0]);
    let low = 0;
    let high = 1;
    for (let i = 0; i < 20; i += 1) {
      const middle = (low + high) / 2;
      const path = originalPoints.map((point) => ({
        ...point,
        x: point.x + shift.x * middle,
        y: point.y + shift.y * middle,
      }));
      if (inside(path)) low = middle;
      else high = middle;
    }
    moved = originalPoints.map((point) => ({
      ...point,
      x: point.x + shift.x * low,
      y: point.y + shift.y * low,
    }));
    guides.length = 0;
  }
  return { points: moved, guides, keys };
}
