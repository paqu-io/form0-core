import { columnCorners } from './free-wall-targets.js';

/**
 * Where a door or window can go along a wall face (3b of the building plan UI round,
 * 2026-11-20): the face's segment, minus the openings in its physical wall (from either side) and
 * the columns standing against it or in it. Ratios of the segment, canvas units in, from the
 * canvas snapshot.
 */

/** Closer than this to a wall's face (a millimetre), a column stands against it. */
const AGAINST_M = 0.001;

/** A face segment's frame: its start, unit direction, normal and length (canvas units). */
export function segmentFrame(points, segmentIndex) {
  const a = points?.[segmentIndex];
  const b = points?.[segmentIndex + 1];
  if (!a || !b) return null;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!length) return null;
  const tangent = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  return { start: a, end: b, length, tangent, normal: { x: -tangent.y, y: tangent.x } };
}

const along = (frame, point) =>
  (point.x - frame.start.x) * frame.tangent.x + (point.y - frame.start.y) * frame.tangent.y;
const across = (frame, point) =>
  (point.x - frame.start.x) * frame.normal.x + (point.y - frame.start.y) * frame.normal.y;

/** The range of `values`. */
const span = (values) => [Math.min(...values), Math.max(...values)];

/** [0, 1] minus the `blocked` intervals (touching is not blocking). */
function freeOf(blocked) {
  const sorted = blocked
    .map(([a, b]) => [Math.max(0, a), Math.min(1, b)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const free = [];
  let from = 0;
  for (const [a, b] of sorted) {
    if (a > from) free.push([from, a]);
    from = Math.max(from, b);
  }
  if (from < 1) free.push([from, 1]);
  return free;
}

/**
 * The free stretches of a wall face's segment.
 * @param {object} view the canvas snapshot, with `gridSize`
 * @param {{ wallId: string, segmentIndex?: number, ignoreOpeningId?: string | null,
 *   openings?: boolean }} options `ignoreOpeningId`: an opening being moved (its physical id);
 *   `openings`: false to count only columns (a drag, where core refuses an opening dropped on
 *   another and shows why)
 * @returns {{ frame: object, stretches: Array<[number, number]> } | null}
 */
export function openingStretches(
  view,
  { wallId, segmentIndex = 0, ignoreOpeningId = null, openings = true }
) {
  const gridSize = view.gridSize || 20;
  const wall = (view.walls || []).find((entry) => entry.id === wallId);
  const frame = wall && segmentFrame(wall.points, segmentIndex);
  if (!frame) return null;
  const ratio = (value) => value / frame.length;
  const blocked = [];
  if (openings)
    for (const opening of view.physicalOpenings || []) {
      if (opening.wallId !== wall.physicalWallId || opening.id === ignoreOpeningId) continue;
      const ends = [opening.points?.[0], opening.points?.at(-1)].filter(Boolean);
      if (ends.length === 2) blocked.push(span(ends.map((end) => ratio(along(frame, end)))));
    }
  // The wall's band across the segment: from its face through its body, a millimetre past both.
  const body = (view.wallFootprints || []).find((entry) => entry.id === wall.physicalWallId);
  const offsets = (body?.polygons || []).flat().map((point) => across(frame, point));
  const reach = AGAINST_M * gridSize;
  const [low, high] = offsets.length
    ? span([...offsets, 0])
    : span([0, (wall.thickness ?? 0) * gridSize]);
  const rooms = view.rooms || [];
  for (const column of view.columns || []) {
    const corners = columnCorners(
      column,
      rooms.find((room) => room.id === column.roomId),
      gridSize
    );
    if (corners.length !== 4) continue;
    const [near, far] = span(corners.map((corner) => across(frame, corner)));
    if (far <= low - reach || near >= high + reach) continue;
    blocked.push(span(corners.map((corner) => ratio(along(frame, corner)))));
  }
  return { frame, stretches: freeOf(blocked) };
}

/**
 * Ratios of a face's segment to metres along its physical wall and back, through the segment's
 * binding (`interval` in metres, `direction`), for the 1 cm step.
 */
export function bindingScale(binding) {
  const [from, to] = binding?.interval || [];
  const length = to - from;
  if (!(length > 0)) return null;
  const forward = binding.direction > 0;
  return {
    toMetres: (value) => (forward ? from + value * length : to - value * length),
    toRatio: (metres) => (forward ? (metres - from) / length : (to - metres) / length),
  };
}
