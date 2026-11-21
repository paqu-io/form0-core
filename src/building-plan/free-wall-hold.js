import { GEOMETRY_EPSILON as EPS, cross } from './geometry.js';
import { CUT_REACH, MIN_SIN, TOUCH_M, freeWallFits, onOutline } from './free-wall-body.js';

/**
 * How far a free wall being moved, or an end being drawn or dragged, may go (4a-3b, 2026-11-20):
 * as far as its body still fits its room (`free-wall-body.js`), then onto the 1 cm step when that
 * still fits, so a wall stopped against a face lies flush on whole centimetres.
 */

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const unit = (v) => {
  const size = Math.hypot(v.x, v.y);
  return size > EPS ? { x: v.x / size, y: v.y / size } : null;
};
const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** The outline edges' directions within `reach` of an end of `points` (the faces it meets). */
function faceDirections(points, outline, reach) {
  const ends = [points[0], points.at(-1)];
  return outline.flatMap((a, index) => {
    const b = outline[(index + 1) % outline.length];
    const tangent = unit(sub(b, a));
    if (!tangent) return [];
    const near = ends.some((end) => {
      const along = (end.x - a.x) * tangent.x + (end.y - a.y) * tangent.y;
      const t = Math.max(0, Math.min(gap(a, b), along));
      return gap(end, { x: a.x + tangent.x * t, y: a.y + tangent.y * t }) <= reach;
    });
    return near ? [tangent] : [];
  });
}

/**
 * `points` moved square to the face nearest one of its ends, within `reach`, so that end lies on
 * it exactly (a held or slid wall ends a hair off the face it met), when that still fits.
 */
function ontoFace(points, outline, reach, inside) {
  let best = null;
  for (const end of [points[0], points.at(-1)])
    outline.forEach((a, index) => {
      const b = outline[(index + 1) % outline.length];
      const tangent = unit(sub(b, a));
      if (!tangent) return;
      const along = (end.x - a.x) * tangent.x + (end.y - a.y) * tangent.y;
      if (along < 0 || along > gap(a, b)) return;
      const foot = { x: a.x + tangent.x * along, y: a.y + tangent.y * along };
      const error = gap(end, foot);
      if (error <= reach && (!best || error < best.error))
        best = { error, v: { x: foot.x - end.x, y: foot.y - end.y } };
    });
  if (!best || best.error === 0) return points;
  const moved = points.map((p) => ({ ...p, x: p.x + best.v.x, y: p.y + best.v.y }));
  return inside(moved) ? moved : points;
}

/**
 * A moved free wall held where it still fits (4a-3b; sliding after the 4a-3b hand test): from
 * `originalPoints` towards `moved` as far as `inside` holds, then on along what stopped it with
 * the rest of the move (across or down the page, or along a face an end or side met), so a wall
 * against a face slides along it as the pointer goes instead of staying where it was. Then back
 * onto the step (`step`) along what it moved, towards where it came from, when that still fits and
 * leaves no end it had on a face off it.
 * @param {{ outline?: object[], half?: number, touch?: number }} [room] the room's outline, the
 *   wall's half-thickness and how near counts as on, in canvas units
 */
export function holdFreeWallMove(originalPoints, moved, inside, step, room = {}) {
  const { outline = [], half = 0, touch = 0 } = room;
  const by = (base, v, t) =>
    base.map((point) => ({ ...point, x: point.x + v.x * t, y: point.y + v.y * t }));
  const furthest = (base, v) => {
    let [low, high] = [0, 1];
    for (let i = 0; i < 20; i += 1) {
      const middle = (low + high) / 2;
      if (inside(by(base, v, middle))) low = middle;
      else high = middle;
    }
    return low;
  };
  const shift = sub(moved[0], originalPoints[0]);
  const low = furthest(originalPoints, shift);
  let held = by(originalPoints, shift, low);
  const rest = { x: shift.x * (1 - low), y: shift.y * (1 - low) };
  let best = null;
  for (const dir of [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    ...faceDirections(held, outline, half + touch),
  ]) {
    const amount = rest.x * dir.x + rest.y * dir.y;
    if (Math.abs(amount) <= touch) continue;
    const v = { x: dir.x * amount, y: dir.y * amount };
    const t = furthest(held, v);
    if (Math.abs(amount) * t > touch && (!best || Math.abs(amount) * t > best.gained))
      best = { points: by(held, v, t), gained: Math.abs(amount) * t };
  }
  if (best) held = best.points;
  held = ontoFace(held, outline, touch * CUT_REACH, inside);
  const back = Object.fromEntries(
    ['x', 'y'].map((c) => {
      if (Math.abs(held[0][c] - originalPoints[0][c]) <= touch) return [c, 0];
      const value = held[0][c] / step;
      const toward = originalPoints[0][c] < held[0][c] ? Math.floor : Math.ceil;
      const onStep = Math.abs(value - Math.round(value)) < 1e-3 ? Math.round(value) : null;
      return [c, (onStep ?? toward(value)) * step - held[0][c]];
    })
  );
  const stepped = held.map((point) => ({ ...point, x: point.x + back.x, y: point.y + back.y }));
  const onFace = (point) => outline.length >= 3 && onOutline(point, outline, touch);
  const kept = [0, held.length - 1].every((i) => !onFace(held[i]) || onFace(stepped[i]));
  return kept && inside(stepped) ? stepped : held;
}

/** Where the ray from `from` along `span` first crosses the outline past `from` (t in spans). */
function firstCrossing(from, span, outline) {
  let best = null;
  outline.forEach((a, index) => {
    const edge = sub(outline[(index + 1) % outline.length], a);
    const denominator = cross(span, edge);
    if (Math.abs(denominator) <= EPS) return;
    const t = cross(sub(a, from), edge) / denominator;
    const u = cross(sub(a, from), span) / denominator;
    if (t > EPS && u >= -EPS && u <= 1 + EPS && (!best || t < best.t))
      best = { t, sin: Math.abs(cross(unit(span), unit(edge))) };
  });
  return best;
}

/**
 * An end of a free wall being drawn or dragged (`from`, the other end, held) settled so the wall
 * fits its room: where it is; else on the face its line runs into, when the end has come within
 * the reach of its body (it is cut along the face there); else as far from `last` (where it last
 * fitted, else `from`) towards where it is as still fits; else where it is (core then refuses it,
 * naming the wall).
 */
export function settleFreeWallEnd(from, end, half, outline, touch = TOUCH_M, last = null) {
  const fits = (point) => freeWallFits([from, point], half, outline, touch);
  if (fits(end)) return end;
  const span = sub(end, from);
  const length = Math.hypot(span.x, span.y);
  if (length <= EPS) return end;
  const hit = firstCrossing(from, span, outline);
  if (hit && hit.t > 1 && (hit.t - 1) * length <= half / Math.max(hit.sin, MIN_SIN) + half) {
    const onFace = { x: from.x + span.x * hit.t, y: from.y + span.y * hit.t };
    if (fits(onFace)) return onFace;
  }
  const base = last && gap(last, from) > touch && fits(last) ? last : from;
  const along = (t) => ({ x: base.x + (end.x - base.x) * t, y: base.y + (end.y - base.y) * t });
  let [low, high] = [0, 1];
  for (let i = 0; i < 24; i += 1) {
    const middle = (low + high) / 2;
    if (fits(along(middle))) low = middle;
    else high = middle;
  }
  const settled = along(low);
  return gap(settled, from) > touch ? settled : end;
}

/**
 * A free wall's split point being dragged to bend it (4a-4): where both runs (from `a` to it, and
 * from it to `b`) still fit their room; else as far from `last` (where it last fitted) towards it
 * as still fits; else where it is (core then refuses, naming the wall).
 */
export function holdFreeWallBend([a, b], point, last, half, outline, touch = TOUCH_M) {
  const fits = (p) =>
    freeWallFits([a, p], half, outline, touch) && freeWallFits([p, b], half, outline, touch);
  if (fits(point) || !last || !fits(last)) return point;
  const along = (t) => ({ x: last.x + (point.x - last.x) * t, y: last.y + (point.y - last.y) * t });
  let [low, high] = [0, 1];
  for (let i = 0; i < 24; i += 1) {
    const middle = (low + high) / 2;
    if (fits(along(middle))) low = middle;
    else high = middle;
  }
  return along(low);
}
