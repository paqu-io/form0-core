import { STEP_M, snapFreeWallEnd } from './free-wall-snapping.js';
import { holdFreeWallBend } from './free-wall-hold.js';
import { TOUCH_M } from './free-wall-body.js';

/**
 * A run's line, from its far end through the split point as the drag found it, long enough to
 * cross the room either way (a segment, as the other line targets are).
 */
function runLine(end, start, outline) {
  const length = Math.hypot(start.x - end.x, start.y - end.y);
  if (!length) return null;
  const xs = outline.map((point) => point.x);
  const ys = outline.map((point) => point.y);
  const reach =
    length +
    (outline.length
      ? Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
      : 0);
  const u = { x: (start.x - end.x) / length, y: (start.y - end.y) / length };
  return [
    { x: end.x - u.x * reach, y: end.y - u.y * reach },
    { x: end.x + u.x * reach, y: end.y + u.y * reach },
  ];
}

/**
 * A point the pull put on a run's line, on the 1 cm step from the run's far end (so the run's
 * length is whole centimetres), with a guide from that end.
 */
function onRun(snapped, end, start, step) {
  const length = Math.hypot(start.x - end.x, start.y - end.y);
  const u = { x: (start.x - end.x) / length, y: (start.y - end.y) / length };
  const { point } = snapped;
  const off = (point.x - end.x) * u.y - (point.y - end.y) * u.x;
  if (Math.abs(off) > 1e-6 * step) return snapped;
  const t = Math.round(((point.x - end.x) * u.x + (point.y - end.y) * u.y) / step) * step;
  const placed = { x: end.x + u.x * t, y: end.y + u.y * t };
  return {
    ...snapped,
    point: placed,
    guides: [...snapped.guides, { from: { ...end }, to: placed }],
  };
}

/**
 * A free wall's split point being dragged to bend it (4a-4, 2026-11-20): pulled as a free wall's
 * end is (corners and ends, lines, lining up, else the 1 cm step; inside the room), with no
 * horizontal or vertical lock, then held where both runs' bodies still fit, else where it last did.
 * The runs' own lines as the drag found them pull it too (2026-11-22), after corners and ends: on
 * one, that run keeps its direction; on a straight wall both are the wall's line, so the point
 * slides along it, on the 1 cm step from the run's far end. A guide runs from that end.
 * @param {{ x: number, y: number }} point
 * @param {{ ends: [object, object], start?: object | null, last?: object | null, half: number,
 *   targets: object, gridSize: number, tolerance: (key: string) => number, free?: boolean }}
 *   options `ends`: the runs' far ends (the earlier portion's start, the later portion's end);
 *   `start`: the split point when the drag began
 */
export function snapFreeWallBend(
  point,
  { ends, start = null, last = null, half, targets, gridSize, tolerance, free }
) {
  const runs = start
    ? ends
        .map((end) => ({ end, line: runLine(end, start, targets.outline) }))
        .filter(({ line }) => line)
    : [];
  const base = targets.lines.length;
  const snapped = snapFreeWallEnd(point, {
    targets: { ...targets, lines: [...targets.lines, ...runs.map(({ line }) => line)] },
    gridSize,
    tolerance,
    free,
  });
  const run = snapped.keys
    .map((key) => runs[Number(/^line:(\d+)$/.exec(key)?.[1]) - base])
    .find(Boolean);
  const guided = run ? onRun(snapped, run.end, start, STEP_M * gridSize) : snapped;
  const held = holdFreeWallBend(
    ends,
    guided.point,
    last,
    half,
    targets.outline,
    TOUCH_M * gridSize
  );
  return held === guided.point ? guided : { point: held, guides: [], keys: [] };
}
