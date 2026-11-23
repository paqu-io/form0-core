import { add, cross, dot, length, multiply, pointInPolygon, subtract } from './geometry.js';
import { edgesOf } from './free-wall-targets.js';

/**
 * The floor below in a free wall's and a column's pulls (U6, 2026-11-23; F3 for rooms). Its wall
 * bands' corners join the corners an end or a column's corner snaps to (where the element may
 * stand) and the corners it lines up with (anywhere); the bands' edges, the faces below, join the
 * lines; for a column, the centres of the columns below, for its centre to stand over whatever
 * their sizes. Each target is marked `below` (a face by its ends) and comes after this floor's,
 * so a tie goes to this floor (U8). A pull that takes one rings the point it took (`belowRing`:
 * the canvas rings a guide's `from`, U7). A pull that places the whole element (a column over a
 * column below, a wall stacked on a wall below) rings its grip instead, which would hide a small
 * ring (option 1, 2026-11-23): the guide names the grip (`grip`), the canvas sizes the ring.
 *
 * A moved free wall takes the floor below as one move (`belowMove`): across, onto the wall below
 * (stacked, or a side flush with a face running with it); along, its end onto a face crossing it.
 * Both together, so a wall stacked on the wall below keeps the stack where its end meets a
 * junction or a jamb (asked at U6's hand test, 2026-11-23: a corner below took the wall's
 * centreline end, and a crossing face its end alone, either leaving it half off). Corners below
 * don't take a moved wall: where a running face meets a crossing one is a corner.
 *
 * Only the drag paths read these (`interaction.js`): placing a column at its room's centre
 * ("select, then add", `element-placement.js`) takes the plain targets.
 */

// Lines that turn by less than this (sine) are parallel.
const PARALLEL = 1e-3;

const mark = (point) => ({ x: point.x, y: point.y, below: true });
const centreOf = (corners) => ({
  x: corners.reduce((sum, point) => sum + point.x, 0) / corners.length,
  y: corners.reduce((sum, point) => sum + point.y, 0) / corners.length,
});

/** Whether a target (a point, or a line by its ends) is the floor below's. */
export const isBelow = (target) => Boolean(target?.below || target?.[0]?.below);

/**
 * A ring on a point of the floor below that a pull took: a guide with no length.
 * @param {{ x: number, y: number }} point
 * @param {'wall' | 'column' | null} grip around that grip, centred on it (`point` its centre)
 */
export const belowRing = (point, grip = null) => ({
  from: { x: point.x, y: point.y },
  to: { x: point.x, y: point.y },
  below: true,
  ...(grip ? { grip } : {}),
});

/** A path's middle along its length: where the canvas puts a free wall's grip. */
function middleOf(path) {
  let rest =
    path.slice(1).reduce((sum, point, index) => sum + length(subtract(point, path[index])), 0) / 2;
  for (let index = 1; index < path.length; index += 1) {
    const run = length(subtract(path[index], path[index - 1]));
    if (rest <= run || index === path.length - 1) {
      const t = run ? Math.min(rest / run, 1) : 0.5;
      return add(path[index - 1], multiply(subtract(path[index], path[index - 1]), t));
    }
    rest -= run;
  }
  return path[0];
}

/**
 * A guide from `target` (lining up with it) to `to`, marked when the target is below. The target
 * is copied as today's guides copy it, without its mark; `to` is kept as given.
 */
export function pullGuide(target, to) {
  const { below, ...from } = target;
  return below ? { from, to, below: true } : { from, to };
}

/**
 * `targets` with the floor below's added (none without one).
 * @param {object} targets `freeWallTargets` or `columnTargets`
 * @param {object} view the canvas snapshot, with `floorBelow` (null when its pulls are off)
 * @param {object[][]} region where the element may stand: corners below outside it are left out
 * @param {{ columns?: boolean }} options `columns`: add `columnsBelow` (their centres)
 */
export function withFloorBelow(targets, view, region, { columns = false } = {}) {
  const below = view.floorBelow;
  if (!below) return columns ? { ...targets, columnsBelow: [] } : targets;
  const inside = (point) =>
    region.some((polygon) => polygon.length > 2 && pointInPolygon(point, polygon, true));
  const bands = (below.walls || []).filter((polygon) => polygon.length > 2);
  const corners = bands.flat().map(mark);
  return {
    ...targets,
    points: [...targets.points, ...corners.filter(inside)],
    lines: [...targets.lines, ...bands.flatMap(edgesOf).map(([a, b]) => [mark(a), mark(b)])],
    align: [...targets.align, ...corners],
    ...(columns
      ? {
          columnsBelow: (below.columns || [])
            .filter((corners) => corners.length > 2)
            .map((corners) => mark(centreOf(corners)))
            .filter(inside),
        }
      : {}),
  };
}

const unit = (a, b) => {
  const span = subtract(b, a);
  const size = length(span);
  return size ? multiply(span, 1 / size) : null;
};

/** Whether `line` is a face below running with the segment `a`–`b`. */
function alongFaceBelow(line, a, b) {
  const u = unit(a, b);
  const v = unit(line[0], line[1]);
  return Boolean(isBelow(line) && u && v && Math.abs(cross(u, v)) < PARALLEL);
}

/**
 * A moved free wall's side flush with a face below running with it (U6: a wall stacked on the
 * wall below): for each run of the moved path and each side of it (`half` from its centreline),
 * each face below along it within reach and beside it.
 * @param {Array<{ x: number, y: number }>} path the moved path (its centreline)
 * @param {number} half its half-thickness, canvas units
 * @param {object[][]} lines the targets' lines (the faces below among them)
 * @param {(key: string) => number} tolerance
 * @returns {Array<{ key: string, error: number, delta: object }>}
 */
function flushWithFacesBelow(path, half, lines, tolerance) {
  const entries = [];
  for (let run = 1; run < path.length; run += 1) {
    const [p, q] = [path[run - 1], path[run]];
    const u = unit(p, q);
    if (!u) continue;
    const n = { x: -u.y, y: u.x };
    const span = dot(subtract(q, p), u);
    lines.forEach((line, index) => {
      if (!alongFaceBelow(line, p, q)) return;
      const key = `flush:${index}`;
      const along = line.map((point) => dot(subtract(point, p), u));
      const overlap = Math.min(span, Math.max(...along)) - Math.max(0, Math.min(...along));
      if (overlap < -tolerance(key)) return;
      const offset = dot(subtract(line[0], p), n);
      for (const side of [half, -half]) {
        const error = Math.abs(offset - side);
        if (error > tolerance(key)) continue;
        entries.push({ key, error, delta: multiply(n, offset - side) });
      }
    });
  }
  return entries;
}

/**
 * A moved free wall's end onto a face below crossing its run: moved along the run until the end
 * meets the face, within the face (its ends are corners, where a running face takes over). A small
 * ring where it meets it.
 * @returns {Array<{ key: string, error: number, delta: object, guide: object }>}
 */
function endsOnFacesBelow(path, lines, tolerance) {
  const entries = [];
  const ends = [
    [path[0], path[1]],
    [path.at(-1), path.at(-2)],
  ];
  for (const [end, inner] of ends) {
    const u = unit(inner, end);
    if (!u) continue;
    lines.forEach((line, index) => {
      if (!isBelow(line) || alongFaceBelow(line, inner, end)) return;
      const v = unit(line[0], line[1]);
      if (!v) return;
      const m = { x: -v.y, y: v.x };
      const shift = dot(subtract(line[0], end), m) / dot(u, m);
      const key = `cross:${index}`;
      if (Math.abs(shift) > tolerance(key)) return;
      const meets = add(end, multiply(u, shift));
      const at = dot(subtract(meets, line[0]), v);
      if (at < -1e-9 || at > length(subtract(line[1], line[0])) + 1e-9) return;
      entries.push({
        key,
        error: Math.abs(shift),
        delta: multiply(u, shift),
        guide: belowRing(meets),
      });
    });
  }
  return entries;
}

const nearestOf = (entries) =>
  entries.reduce((best, entry) => (!best || entry.error < best.error ? entry : best), null);

/**
 * The floor below's pull on a moved free wall, as one move: across onto it (`flushWithFacesBelow`),
 * then along to a face crossing an end (`endsOnFacesBelow`, from where the first puts it). Null
 * when neither is within reach. `error`: how far it moves the wall.
 * @param {Array<{ x: number, y: number }>} path the moved path (its centreline)
 * @param {number} half its half-thickness, canvas units
 * @param {object[][]} lines the targets' lines (the faces below among them)
 * @param {(key: string) => number} tolerance
 * @returns {{ keys: string[], error: number, delta: object, guides: object[] } | null}
 */
export function belowMove(path, half, lines, tolerance) {
  const across = nearestOf(flushWithFacesBelow(path, half, lines, tolerance));
  const shift = across ? across.delta : { x: 0, y: 0 };
  const moved = path.map((point) => add(point, shift));
  const along = nearestOf(endsOnFacesBelow(moved, lines, tolerance));
  if (!across && !along) return null;
  const delta = add(shift, along ? along.delta : { x: 0, y: 0 });
  return {
    keys: [across, along].filter(Boolean).map((part) => part.key),
    error: Math.hypot(across?.error ?? 0, along?.error ?? 0),
    delta,
    // Stacked: a ring around the wall's grip, at its middle where the move puts it.
    guides: [
      ...(across ? [belowRing(add(middleOf(path), delta), 'wall')] : []),
      ...(along ? [along.guide] : []),
    ],
  };
}
