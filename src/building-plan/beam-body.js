import { CUT_REACH, TOUCH_M, cutBand, freeWallFits, outlineCuts } from './free-wall-body.js';

/**
 * A room beam's body (3a-3, 2026-11-23; B1 and B6 of the beams round): a band of its width
 * around its centreline, an end on its room's outline cut along it (along both faces in a convex
 * corner), else square, as a free wall's (`free-wall-body.js`). The room contents check reads it
 * from here, the canvas snapshot carries it for the drawing. Any one unit; `touch` is how near
 * counts as on (0.1 mm in metres).
 */

/**
 * A beam's outline.
 * @param {{ x: number, y: number }} start its centreline's start
 * @param {{ x: number, y: number }} end
 * @param {number} half half its width
 * @param {Array<{ x: number, y: number }>} outline its room's
 * @returns {Array<{ x: number, y: number }>} the polygon, empty for no length or no width
 */
export function beamOutline(start, end, half, outline = [], touch = TOUCH_M) {
  const cuts = (point) =>
    outline.length >= 3 ? outlineCuts(point, outline, touch * CUT_REACH) : [];
  return cutBand(start, end, half, [cuts(start), cuts(end)]);
}

/**
 * Whether a beam fits its room (rule 1, B1): its centreline and its body inside the outline,
 * touching allowed, its ends cut along the faces they stop on (the free wall rule).
 */
export const beamFits = (start, end, half, outline, touch = TOUCH_M) =>
  freeWallFits([start, end], half, outline, touch);
