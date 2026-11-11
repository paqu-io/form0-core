import { GAP_TOLERANCE, SAME, along, offset, overlap, pointAt } from './grid.js';
import { anchorAt } from './line-spans.js';
import { resolveWallThickness } from './thickness.js';

/** Today's exactness for an unsnapped contact (1 µm), so tolerance 0 behaves as before. */
export const EXACT = 1e-6;

/**
 * Two room lines facing each other: opposite directions, overlapping, parallel over the overlap.
 * Returns the gap outward from `a` and the overlap in both lines' stations.
 */
export function facingGap(a, b) {
  if (a.frame.tangent.x * b.frame.tangent.x + a.frame.tangent.y * b.frame.tangent.y >= 0)
    return null;
  const interval = overlap(
    [0, a.frame.length],
    [along(a.frame, b.frame.start), along(a.frame, b.frame.end)]
  );
  if (!interval) return null;
  const gaps = interval.map(
    (station) =>
      a.outward * offset(a.frame, pointAt(b.frame, along(b.frame, pointAt(a.frame, station))))
  );
  if (Math.abs(gaps[0] - gaps[1]) > GAP_TOLERANCE) return null;
  const onB = interval
    .map((station) => along(b.frame, pointAt(a.frame, station)))
    .sort((x, y) => x - y);
  return { gap: (gaps[0] + gaps[1]) / 2, onA: interval, onB };
}

/**
 * The widths a new contact between room `roomId` and the wall on line `b` may land at: the wall's
 * current width (as an exterior wall of b's room) and the width the contact would inherit. The
 * contact lands at the inherited width, or at the current one with "Keep previous values".
 */
export function contactWindow(primary, floor, specifications, roomId, b, stretch, keep) {
  const subject = primary.subjects.get(anchorAt(b, ...stretch)?.subjectId) || null;
  const width = (rooms) => resolveWallThickness(floor, specifications, subject, rooms).value;
  const inherited = width([roomId, b.roomId]);
  const existing = width([b.roomId, null]);
  const widths = [...new Set([existing, inherited])].filter((value) => value > 0);
  const seat = keep && existing > 0 ? existing : inherited > 0 ? inherited : null;
  return { widths, inherited, existing, seat };
}

/** The window width a gap meets within the tolerance, if any. */
export function matchedWidth(window, gap, tolerance) {
  const near = [...window.widths].sort((x, y) => Math.abs(gap - x) - Math.abs(gap - y))[0];
  return near != null && Math.abs(gap - near) <= tolerance + EXACT ? near : null;
}

export { SAME };
