import { solveSeatingDelta } from '../attachment-seating.js';
import { SAME } from './grid.js';
import { roomLines } from './room-lines.js';
import { annotateLines } from './line-spans.js';
import { resolutionFloor } from './thickness.js';
import { contactWindow, facingGap, matchedWidth } from './contact-window.js';

const refuse = (code, message) => {
  throw Object.assign(new Error(message), { issues: [{ code, message }] });
};

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
      const found = facingGap(a, b);
      if (!found || found.gap <= SAME) continue;
      const window = contactWindow(primary, floor, specifications, roomId, b, found.onB, keep);
      const near = matchedWidth(window, found.gap, tolerance);
      if (near == null) continue;
      const mismatch = Math.abs(found.gap - near);
      if (best && best.mismatch <= mismatch) continue;
      const { inherited } = window;
      best = { a, b, gap: found.gap, seat: window.seat ?? near, inherited, mismatch };
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
