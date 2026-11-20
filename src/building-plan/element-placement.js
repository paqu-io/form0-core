import { columnTargets } from './column-targets.js';
import { snapColumn } from './column-snapping.js';
import { bindingScale, openingStretches, segmentFrame } from './opening-stretches.js';

/**
 * Adding a column, door or window by "select, then add" (3b of the building plan UI round,
 * 2026-11-20): what the selection and the insertion mark ask for, moved to the nearest place that
 * fits, or null when there is none. Canvas units, from the canvas snapshot; hosts create the
 * element from the result.
 */

/** One centimetre in metres: an opening's start and width are whole centimetres. */
const STEP_M = 0.01;

/** The segment of a face nearest to `point` (the first without one). */
function nearestSegment(points, point) {
  let best = { index: 0, distance: Infinity };
  for (let index = 0; index < (points?.length || 0) - 1; index += 1) {
    const frame = segmentFrame(points, index);
    if (!frame || !point) continue;
    const t = Math.max(
      0,
      Math.min(
        frame.length,
        (point.x - frame.start.x) * frame.tangent.x + (point.y - frame.start.y) * frame.tangent.y
      )
    );
    const foot = { x: frame.start.x + frame.tangent.x * t, y: frame.start.y + frame.tangent.y * t };
    const distance = Math.hypot(point.x - foot.x, point.y - foot.y);
    if (distance < best.distance) best = { index, distance };
  }
  return best.index;
}

/**
 * Where a door or window goes on a wall face: centred on the mark, inside the free stretch that
 * holds it, else the nearest one wide enough; without a mark, the middle of the widest stretch.
 * Its start on the 1 cm step along the physical wall.
 * @param {object} view the canvas snapshot, with `gridSize`
 * @param {{ wallId: string, width: number, mark?: { x: number, y: number } | null }} options
 *   `width` in metres
 * @returns {{ segmentIndex: number, startRatio: number, endRatio: number, width: number } | null}
 */
export function placeBuildingPlanOpening(view, { wallId, width, mark = null }) {
  const gridSize = view.gridSize || 20;
  const wall = (view.walls || []).find((entry) => entry.id === wallId);
  if (!wall) return null;
  const segmentIndex = mark
    ? nearestSegment(wall.points, mark)
    : (wall.points || [])
        .slice(1)
        .map((_, index) => segmentFrame(wall.points, index)?.length || 0)
        .reduce((best, length, index, all) => (length > all[best] ? index : best), 0);
  const found = openingStretches(view, { wallId, segmentIndex });
  if (!found) return null;
  const { frame, stretches } = found;
  const size = (width * gridSize) / frame.length;
  const wide = stretches.filter(([a, b]) => b - a >= size - 1e-9);
  if (!wide.length) return null;
  let centre;
  let stretch;
  if (mark) {
    const t = Math.max(
      0,
      Math.min(
        1,
        ((mark.x - frame.start.x) * frame.tangent.x + (mark.y - frame.start.y) * frame.tangent.y) /
          frame.length
      )
    );
    const away = ([a, b]) => (t < a ? a - t : t > b ? t - b : 0);
    stretch = wide.reduce((best, entry) => (away(entry) < away(best) ? entry : best));
    centre = Math.max(stretch[0] + size / 2, Math.min(stretch[1] - size / 2, t));
  } else {
    stretch = wide.reduce((best, entry) =>
      entry[1] - entry[0] > best[1] - best[0] ? entry : best
    );
    centre = (stretch[0] + stretch[1]) / 2;
  }
  let startRatio = centre - size / 2;
  let endRatio = centre + size / 2;
  const scale = bindingScale(wall.bindings?.[segmentIndex]);
  if (scale) {
    // The start along the physical wall on whole centimetres, inside the stretch.
    const ends = [scale.toMetres(startRatio), scale.toMetres(endRatio)];
    const low = Math.min(...ends);
    const limits = [scale.toMetres(stretch[0]), scale.toMetres(stretch[1])];
    const [min, max] = [Math.min(...limits), Math.max(...limits)];
    const steps = [Math.round, Math.ceil, Math.floor].map(
      (round) => round(low / STEP_M - 1e-9) * STEP_M
    );
    const start = steps.find((value) => value >= min - 1e-9 && value + width <= max + 1e-9);
    if (start != null) {
      const ratios = [scale.toRatio(start), scale.toRatio(start + width)];
      startRatio = Math.max(0, Math.min(...ratios));
      endRatio = Math.min(1, Math.max(...ratios));
    }
  }
  return { segmentIndex, startRatio, endRatio, width };
}

/** The room's centre: the middle of its outline's box. */
function roomCentre(room) {
  const xs = (room?.vertices || []).map((point) => point.x);
  const ys = (room?.vertices || []).map((point) => point.y);
  if (!xs.length) return null;
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/** A column flush against the wall at `mark`, on the room's side of it (the nearer side of a free wall). */
function againstWall(view, wall, mark, half) {
  const frame = segmentFrame(wall.points, nearestSegment(wall.points, mark));
  if (!frame) return mark;
  const gridSize = view.gridSize || 20;
  const t = Math.max(
    0,
    Math.min(
      frame.length,
      (mark.x - frame.start.x) * frame.tangent.x + (mark.y - frame.start.y) * frame.tangent.y
    )
  );
  const offsetOf = (point) =>
    (point.x - frame.start.x) * frame.normal.x + (point.y - frame.start.y) * frame.normal.y;
  const body = (view.wallFootprints || []).find((entry) => entry.id === wall.physicalWallId);
  const offsets = (body?.polygons || []).flat().map(offsetOf);
  const thickness = (wall.thickness ?? 0) * gridSize;
  const [low, high] = offsets.length
    ? [Math.min(...offsets, 0), Math.max(...offsets, 0)]
    : [0, thickness];
  let side;
  if (wall.isBoundary || wall.isCutPortion) {
    // The room is on the face's other side from the wall's body.
    side = Math.abs(high) > Math.abs(low) ? { offset: 0, sign: -1 } : { offset: 0, sign: 1 };
  } else {
    const at = offsetOf(mark);
    side =
      Math.abs(at - low) <= Math.abs(at - high)
        ? { offset: low, sign: -1 }
        : { offset: high, sign: 1 };
  }
  const n = { x: frame.normal.x * side.sign, y: frame.normal.y * side.sign };
  const reach = Math.abs(n.x) * half.x + Math.abs(n.y) * half.y;
  return {
    x: frame.start.x + frame.tangent.x * t + frame.normal.x * side.offset + n.x * reach,
    y: frame.start.y + frame.tangent.y * t + frame.normal.y * side.offset + n.y * reach,
  };
}

/**
 * Where a new column goes: flush inside against the selected wall at the mark; else at the mark;
 * else at the room's centre. Then the column pulls, and the nearest place that fits.
 * @param {object} view the canvas snapshot, with `gridSize`
 * @param {{ roomId: string, wallId?: string | null, mark?: { x: number, y: number } | null,
 *   width: number, height: number, zoom?: number }} options sizes in metres
 * @returns {{ x: number, y: number } | null}
 */
export function placeBuildingPlanColumn(
  view,
  { roomId, wallId = null, mark = null, width, height, zoom = 1 }
) {
  const gridSize = view.gridSize || 20;
  const half = { x: (width * gridSize) / 2, y: (height * gridSize) / 2 };
  const wall = wallId && (view.walls || []).find((entry) => entry.id === wallId);
  const room = (view.rooms || []).find((entry) => entry.id === roomId);
  const centre = wall && mark ? againstWall(view, wall, mark, half) : mark || roomCentre(room);
  if (!centre) return null;
  const result = snapColumn(centre, {
    size: { width: half.x * 2, height: half.y * 2 },
    targets: columnTargets(view, { roomId }),
    gridSize,
    tolerance: () => 8 / zoom,
  });
  return result.fits ? result.centre : null;
}
