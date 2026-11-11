import { solveSeatingDelta } from '../attachment-seating.js';
import { GAP_TOLERANCE, SAME, along, offset, overlap, pointAt } from './grid.js';
import { roomLines } from './room-lines.js';
import { anchorAt, annotateLines } from './line-spans.js';
import { resolutionFloor, resolveWallThickness } from './thickness.js';

/** Today's exactness for an unsnapped contact (1 µm), so tolerance 0 behaves as before. */
const EXACT = 1e-6;

const refuse = (code, message) => {
  throw Object.assign(new Error(message), { issues: [{ code, message }] });
};

/** A line of the seated room facing a neighbour's line: overlap and gap (outward from `a`). */
function facing(a, b) {
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
  return { gap: (gaps[0] + gaps[1]) / 2, onB };
}

/**
 * Seat a created or moved room against the rooms already in place (R1: geometry the user is not
 * editing does not move). Each line of the room that faces a neighbour within the tolerance of a
 * contact width (the neighbour wall's current width or the inherited shared width) is moved so
 * the gap equals the seat width: the inherited shared width, or, with "Keep previous values",
 * the neighbour's current width. One translation must satisfy every contact.
 *
 * @returns {{delta: {x: number, y: number}, contactWidths: Array<Object>}} The translation, and
 *   the explicit widths of kept contacts (room lines and width) for the derivation.
 */
export function seatRoom(primary, roomId, { tolerance = 0, keep = false, specifications }) {
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 0.5)
    refuse(
      'invalid_snap_tolerance',
      'Room attachment tolerance must be between zero and half a metre.'
    );
  const floor = resolutionFloor(primary);
  const room = primary.rooms.find((entry) => entry.id === roomId);
  const others = annotateLines(
    primary.rooms.filter((entry) => entry.id !== roomId).flatMap(roomLines),
    primary
  );
  const contacts = [];
  for (const a of roomLines(room)) {
    let best = null;
    for (const b of others) {
      const found = facing(a, b);
      if (!found || found.gap <= SAME) continue;
      const subject = primary.subjects.get(anchorAt(b, ...found.onB)?.subjectId) || null;
      const width = (rooms) => resolveWallThickness(floor, specifications, subject, rooms).value;
      const inherited = width([roomId, b.roomId]);
      const existing = width([b.roomId, null]);
      const widths = [...new Set([existing, inherited])].filter((value) => value > 0);
      if (!widths.length) continue;
      const near = widths.sort((x, y) => Math.abs(found.gap - x) - Math.abs(found.gap - y))[0];
      const mismatch = Math.abs(found.gap - near);
      if (mismatch > tolerance + EXACT || (best && best.mismatch <= mismatch)) continue;
      const seat = keep && existing > 0 ? existing : inherited > 0 ? inherited : near;
      best = { a, b, gap: found.gap, seat, inherited, mismatch };
    }
    if (best) contacts.push(best);
  }
  // Moving the room by delta changes a gap by -delta·n, n being the line's outward normal.
  const delta = solveSeatingDelta(
    contacts.map(({ a, gap, seat }) => ({
      normal: { x: a.outward * a.frame.normal.x, y: a.outward * a.frame.normal.y },
      shift: gap - seat,
    }))
  );
  if (!delta)
    refuse(
      'attachment_fit_conflict',
      'This room cannot meet all of its neighbours at their shared wall thickness. Attach it to fewer rooms or adjust its size.'
    );
  return {
    delta,
    contactWidths: contacts
      .filter((contact) => keep && contact.seat !== contact.inherited)
      .map(({ a, b, seat }) => ({
        lines: [`${a.roomId}:${a.index}`, `${b.roomId}:${b.index}`],
        width: seat,
      })),
  };
}
