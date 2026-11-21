import { snapFreeWallEnd } from './free-wall-snapping.js';
import { holdFreeWallBend } from './free-wall-hold.js';
import { TOUCH_M } from './free-wall-body.js';

/**
 * A free wall's split point being dragged to bend it (4a-4, 2026-11-20): pulled as a free wall's
 * end is (corners and ends, lines, lining up, else the 1 cm step; inside the room), with no
 * horizontal or vertical lock, then held where both runs' bodies still fit, else where it last did.
 * @param {{ x: number, y: number }} point
 * @param {{ ends: [object, object], last?: object | null, half: number, targets: object,
 *   gridSize: number, tolerance: (key: string) => number, free?: boolean }} options `ends`: the
 *   runs' far ends (the earlier portion's start, the later portion's end)
 */
export function snapFreeWallBend(
  point,
  { ends, last = null, half, targets, gridSize, tolerance, free }
) {
  const snapped = snapFreeWallEnd(point, { targets, gridSize, tolerance, free });
  const held = holdFreeWallBend(
    ends,
    snapped.point,
    last,
    half,
    targets.outline,
    TOUCH_M * gridSize
  );
  return held === snapped.point ? snapped : { point: held, guides: [], keys: [] };
}
