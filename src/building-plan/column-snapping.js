import { distance, subtract } from './geometry.js';
import {
  columnFits,
  columnRect,
  nearestColumnFit,
  rectCorners,
  slideColumn,
} from './column-fit.js';
import { belowRing, isBelow, pullGuide } from './floor-below-pulls.js';

/**
 * Snapping for columns (unit 3 of the building plan UI round, 2026-11-20). A column is a
 * rectangle square to the page, moved by its centre. Pulls, in order:
 *
 * 1. a corner into a corner (the room's, its walls', free walls' corners and ends, other columns',
 *    the jambs'), or its centre where wall midlines meet (a corner, a T-junction);
 * 2. per axis, a contact: a side flush with a line it is next to (the room's faces, its walls' far
 *    faces, free walls' sides, other columns' sides, the jambs), or its centre on one of its walls'
 *    midlines; on a slanted line, the nearest corner goes onto it;
 * 3. per axis, lining up: a side with corners and ends anywhere on the floor, its centre with
 *    other columns' centres (a dashed guide);
 * 4. per axis, its sides on the 1 cm step.
 *
 * The floor below (U6, `floor-below-pulls.js`): its wall corners join the corners (1), its faces
 * the lines (2), its corners those to line up with (3); its centre over a column below's centre
 * ranks with the corners (1). Each rings the point it took below; the centre, the column's grip.
 *
 * The first position that fits wins (`column-fit.js`: inside the room and its own walls, clear of
 * other columns and openings). When none fits, a drag stops where the column would leave or
 * overlap, and a placement goes to the nearest place that fits.
 */

/** One centimetre in metres: the step a side takes when nothing pulls it. */
const STEP_M = 0.01;
/** How far a placement looks for a place that fits (metres). */
const PLACE_RADIUS_M = 2;

const straight = (a, b, axis) => Math.abs(a[axis] - b[axis]) <= 1e-9;

function closestOnSegment(point, a, b) {
  const span = subtract(b, a);
  const squared = span.x * span.x + span.y * span.y;
  const t = squared
    ? Math.max(0, Math.min(1, ((point.x - a.x) * span.x + (point.y - a.y) * span.y) / squared))
    : 0;
  return { x: a.x + span.x * t, y: a.y + span.y * t };
}

/** What moves a column along `axis`, best first: contacts, lining up, then the step. */
function axisOptions(axis, centre, rect, { targets, tolerance, step, free }) {
  const other = axis === 'x' ? 'y' : 'x';
  const [min, max] = axis === 'x' ? [rect.minX, rect.maxX] : [rect.minY, rect.maxY];
  const [from, to] = other === 'x' ? [rect.minX, rect.maxX] : [rect.minY, rect.maxY];
  const options = [];
  const add = (rank, delta, key, guides = []) =>
    options.push({ rank, delta, error: Math.abs(delta), keys: key ? [key] : [], guides });
  // A line pulls a side only when the column is beside it.
  const beside = (a, b, key) =>
    Math.min(Math.max(a[other], b[other]), to) - Math.max(Math.min(a[other], b[other]), from) >=
    -tolerance(key);
  if (!free) {
    targets.lines.forEach(([a, b], index) => {
      const key = `${axis}:line:${index}`;
      if (!straight(a, b, axis) || !beside(a, b, key)) return;
      // A face below: a ring where it meets the column's side.
      const ring = () => {
        const [low, high] = [Math.min(a[other], b[other]), Math.max(a[other], b[other])];
        const middle = Math.max(low, Math.min(high, centre[other]));
        return [belowRing({ [axis]: a[axis], [other]: middle })];
      };
      for (const side of [min, max])
        if (Math.abs(a[axis] - side) <= tolerance(key))
          add(1, a[axis] - side, key, isBelow([a, b]) ? ring() : []);
    });
    targets.midlines.forEach(([a, b], index) => {
      const key = `${axis}:mid:${index}`;
      if (!straight(a, b, axis) || !beside(a, b, key)) return;
      if (Math.abs(a[axis] - centre[axis]) <= tolerance(key)) add(1, a[axis] - centre[axis], key);
    });
    targets.align.forEach((target, index) => {
      const key = `${axis}:align:${index}`;
      for (const side of [min, max])
        if (Math.abs(target[axis] - side) <= tolerance(key))
          add(2, target[axis] - side, key, [
            pullGuide(target, {
              [axis]: target[axis],
              [other]: Math.max(from, Math.min(to, target[other])),
            }),
          ]);
    });
    targets.centres.forEach((target, index) => {
      const key = `${axis}:centre:${index}`;
      if (Math.abs(target[axis] - centre[axis]) <= tolerance(key))
        add(2, target[axis] - centre[axis], key, [
          { from: { ...target }, to: { [axis]: target[axis], [other]: centre[other] } },
        ]);
    });
  }
  // The step, rounding first; down and up next, for when the rounded place doesn't fit.
  const steps = [Math.round(min / step), Math.floor(min / step), Math.ceil(min / step)];
  for (const value of new Set(steps)) add(3, value * step - min);
  return options.sort((a, b) => a.rank - b.rank || a.error - b.error);
}

/** Every position the pulls offer around `centre`, best first. */
function offers(centre, half, settings) {
  const { targets, tolerance, free } = settings;
  const rect = columnRect(centre, half);
  const corners = rectCorners(rect);
  const whole = [];
  if (!free) {
    targets.points.forEach((target, index) => {
      const key = `point:${index}`;
      for (const corner of corners)
        if (distance(target, corner) <= tolerance(key))
          whole.push({
            rank: 0,
            delta: subtract(target, corner),
            keys: [key],
            guides: isBelow(target) ? [belowRing(target)] : [],
          });
    });
    // Its centre where wall midlines meet (a corner, a T-junction).
    (targets.junctions || []).forEach((target, index) => {
      const key = `junction:${index}`;
      if (distance(target, centre) <= tolerance(key))
        whole.push({ rank: 0, delta: subtract(target, centre), keys: [key], guides: [] });
    });
    // Its centre over the centre of a column below, whatever their sizes (U6).
    (targets.columnsBelow || []).forEach((target, index) => {
      const key = `over:${index}`;
      if (distance(target, centre) <= tolerance(key))
        whole.push({
          rank: 0,
          delta: subtract(target, centre),
          keys: [key],
          guides: [belowRing(target, 'column')],
        });
    });
    targets.lines.forEach(([a, b], index) => {
      const key = `line:${index}`;
      if (straight(a, b, 'x') || straight(a, b, 'y')) return;
      for (const corner of corners) {
        const point = closestOnSegment(corner, a, b);
        if (distance(point, corner) <= tolerance(key))
          whole.push({
            rank: 3,
            delta: subtract(point, corner),
            keys: [key],
            guides: isBelow([a, b]) ? [belowRing(point)] : [],
          });
      }
    });
  }
  for (const entry of whole) entry.error = Math.hypot(entry.delta.x, entry.delta.y);
  const xs = axisOptions('x', centre, rect, settings);
  const ys = axisOptions('y', centre, rect, settings);
  const shift = (guide, axis, amount) => ({
    ...guide,
    to: { ...guide.to, [axis]: guide.to[axis] + amount },
  });
  const pairs = xs.flatMap((x) =>
    ys.map((y) => ({
      rank: x.rank + y.rank,
      error: x.error + y.error,
      delta: { x: x.delta, y: y.delta },
      keys: [...x.keys, ...y.keys],
      guides: [
        ...x.guides.map((guide) => shift(guide, 'y', y.delta)),
        ...y.guides.map((guide) => shift(guide, 'x', x.delta)),
      ],
    }))
  );
  return [...whole, ...pairs]
    .sort((a, b) => a.rank - b.rank || a.error - b.error)
    .map(({ delta, keys, guides }) => ({
      centre: { x: centre.x + delta.x, y: centre.y + delta.y },
      keys,
      guides,
    }));
}

/**
 * Snaps a column being placed or dragged.
 * @param {{ x: number, y: number }} centre where the pointer puts its centre
 * @param {{
 *   size: { width: number, height: number },
 *   from?: { x: number, y: number } | null,
 *   targets: import('./column-targets.js').ColumnTargets,
 *   gridSize: number,
 *   tolerance: (key: string) => number,
 *   free?: boolean,
 * }} options `size` in canvas units (width along x, depth along y); `from`: where the dragged
 *   column last was (none when placing); `free`: no pulls (Alt, or snapping off), only the step,
 *   the region and the overlaps
 * @returns {{ centre: { x: number, y: number }, fits: boolean, guides: object[], keys: string[] }}
 *   `fits` false when the column fits nowhere near (`centre` is then the one given)
 */
export function snapColumn(
  centre,
  { size, from = null, targets, gridSize, tolerance, free = false }
) {
  const half = { x: size.width / 2, y: size.height / 2 };
  const settings = { targets, tolerance, step: STEP_M * gridSize, free };
  const fits = (point) => columnFits(point, half, targets, gridSize);
  const pick = (point) => offers(point, half, settings).find((offer) => fits(offer.centre));
  const found = pick(centre);
  if (found) return { ...found, fits: true };
  const start =
    from && fits(from)
      ? slideColumn(from, centre, fits)
      : nearestColumnFit(centre, half, targets, fits, {
          step: settings.step,
          radius: PLACE_RADIUS_M * gridSize,
        });
  if (!start) return { centre, fits: false, guides: [], keys: [] };
  return { ...(pick(start) || { centre: start, guides: [], keys: [] }), fits: true };
}
