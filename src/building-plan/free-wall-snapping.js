import { GEOMETRY_EPSILON as EPS, distance, pointInPolygon, subtract } from './geometry.js';
import { closestOnSegment, keepInside, nearest, onStep } from './free-wall-outline.js';
import { TOUCH_M, freeWallFits } from './free-wall-body.js';
import { holdFreeWallMove, settleFreeWallEnd } from './free-wall-hold.js';
import { belowMove, belowRing, isBelow, pullGuide } from './floor-below-pulls.js';

/**
 * Snapping for free walls, the walls that stand in a room (2026-11-19, web UI round). A free
 * wall's end, being drawn or dragged, and a whole free wall being moved:
 *
 * - an end locks horizontal or vertical with the other end when it is within reach of either;
 *   on a locked line the end slides along it, so a corner off the line never bends the wall;
 * - pulls, in order: a corner or end (the room's corners, other free walls' corners and ends,
 *   columns' corners), a line (the room's faces, other free walls' sides, columns' sides), lining
 *   up with corners and ends anywhere on the floor (a dashed guide), else the 1 cm step; the
 *   floor below's corners and faces too (U6, `floor-below-pulls.js`); a moved wall takes the
 *   floor below as one move, across onto the wall below and along to a face crossing its end;
 * - a free wall never leaves its room: an end stops on the room's outline, a moved wall stops
 *   where it would leave it; with `half` (its half-thickness), its body neither (4a-3b).
 *
 * Pure functions in canvas units; the interaction helper holds what was caught between calls
 * (`tolerance(key)` is larger for a key it holds) and shows the guides.
 */

/** One centimetre in metres: the step a position takes when nothing pulls it. */
export const STEP_M = 0.01;

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
  { from = null, targets, gridSize, tolerance, free = false, half = 0, last = null }
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
        return error <= tolerance(key) ? [{ value, key, error, below: isBelow([a, b]) }] : [];
      })
    );
    const lined = hit ? null : lineUp(result, along, targets.align, tolerance);
    if (hit) {
      result[along] = hit.value;
      keys.push(hit.key);
      if (hit.below) guides.push(belowRing(result));
    } else if (lined) {
      result[along] = lined.target[along];
      keys.push(lined.key);
      guides.push(pullGuide(lined.target, { ...result }));
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
              const below = isBelow([a, b]);
              return { target, key: `line:${index}`, error: distance(target, point), below };
            })
            .filter((entry) => entry.error <= tolerance(entry.key))
        );
    if (corner || line) {
      const { below: _, ...target } = (corner || line).target;
      result = target;
      keys.push((corner || line).key);
      if (corner ? isBelow(corner.target) : line.below) guides.push(belowRing(result));
    } else
      for (const coordinate of ['x', 'y']) {
        const lined = lineUp(point, coordinate, targets.align, tolerance);
        if (!lined) continue;
        result[coordinate] = lined.target[coordinate];
        keys.push(lined.key);
        guides.push(pullGuide(lined.target, result));
      }
  }
  const kept = keepInside(result, from, targets.outline);
  // Held inside the room, off what it took below: no ring there.
  if (kept !== result) guides.splice(0, guides.length, ...guides.filter((guide) => !guide.below));
  const stepped = kept === result ? result : onStep(kept, targets.outline, round);
  // Its body stays in the room too (4a-3b): an end near a face meets it, else it stops.
  const settled =
    from && half > 0
      ? settleFreeWallEnd(from, stepped, half, targets.outline, TOUCH_M * gridSize, last)
      : stepped;
  return { point: settled, guides, keys };
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
  { originalPoints, targets, gridSize, tolerance, free = false, half = 0 }
) {
  const step = STEP_M * gridSize;
  const ends = [points[0], points.at(-1)];
  const guides = [];
  const keys = [];
  let delta = null;
  if (!free) {
    // This floor's corners, then lines, take an end, as before; the floor below moves the wall
    // across onto it and along to a face crossing its end, together (U6). Nearest wins; a tie
    // goes to this floor.
    const contacts = (kind, list) =>
      ends
        .flatMap((end) =>
          list.flatMap((target, index) => {
            if (isBelow(target)) return [];
            const point = kind === 'point' ? target : closestOnSegment(end, ...target);
            const error = distance(point, end);
            return [{ keys: [`${kind}:${index}`], error, delta: subtract(point, end), guides: [] }];
          })
        )
        .filter((entry) => entry.error <= tolerance(entry.keys[0]));
    const own =
      nearest(contacts('point', targets.points)) || nearest(contacts('line', targets.lines));
    const below = belowMove(points, half, targets.lines, tolerance);
    const hit = below && (!own || below.error < own.error) ? below : own;
    if (hit) {
      delta = { x: hit.delta.x, y: hit.delta.y };
      keys.push(...hit.keys);
      guides.push(...hit.guides);
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
      guides.push(
        pullGuide(lined.target, { ...lined.end, [coordinate]: lined.target[coordinate] })
      );
    }
    for (const coordinate of ['x', 'y'])
      delta[coordinate] ??= Math.round(ends[0][coordinate] / step) * step - ends[0][coordinate];
  }
  let moved = points.map((point) => ({ ...point, x: point.x + delta.x, y: point.y + delta.y }));
  // Its body too (4a-3b): a move stops flush against a face it would run into.
  const inside = (path) =>
    half > 0
      ? freeWallFits(path, half, targets.outline, TOUCH_M * gridSize)
      : samples(path).every((point) => pointInPolygon(point, targets.outline, true));
  if (targets.outline.length >= 3 && !inside(moved) && inside(originalPoints)) {
    // As far as it goes towards the pointer while it stays in the room, then onto the step.
    moved = holdFreeWallMove(originalPoints, moved, inside, step, {
      outline: targets.outline,
      half,
      touch: TOUCH_M * gridSize,
    });
    guides.length = 0;
  }
  return { points: moved, guides, keys };
}
