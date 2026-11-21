import { along, pointAt } from './grid.js';
import { columnContacts, reach } from './attached-contacts.js';

/**
 * Columns following their wall (4b-2, 2026-11-21; moved out of `follow-attached.js`): which
 * columns follow, the offset from its line each keeps, and a room wall's width where a column
 * holds to its midline or far face. Metres.
 */

const gap = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const cross = (u, v) => u.x * v.y - u.y * v.x;

/**
 * The offset from its line a column keeps (D6): flush, it stays flush (its size as it is now, the
 * line as it turned); centred on a midline, it keeps to the midline as the wall's width changes;
 * flush with the far face, to the far face; in the wall, it keeps its distance from the face.
 */
export function columnTarget(contact, frame, foot, half, widthAfter) {
  const e = reach(half, frame.normal);
  const { kind, outward } = contact;
  if (kind === 'flush') return Math.sign(contact.d) * e;
  if (kind === 'centred' || kind === 'inWall') return contact.d;
  if (kind === 'flushIn') return outward * -e;
  if (kind === 'flushOut') return outward * e;
  const on = pointAt(frame, Math.min(Math.max(along(frame, foot), 0), frame.length));
  const width = widthAfter(contact.anchor.roomId, on, frame.tangent) || contact.width;
  if (kind === 'midline') return outward * (contact.out + (width - contact.width) / 2);
  return outward * (width - e);
}

/**
 * A room wall's width at a point of a room's face running along `tangent` (at a corner, the
 * face that way), from the pieces derived; null if none.
 */
export function wallWidthAt(derived, roomId, point, tangent) {
  for (const line of derived.lines) {
    if (line.roomId !== roomId || Math.abs(cross(line.frame.tangent, tangent)) > 1e-6) continue;
    const station = along(line.frame, point);
    const offset =
      (point.x - line.frame.start.x) * line.frame.normal.x +
      (point.y - line.frame.start.y) * line.frame.normal.y;
    if (Math.abs(offset) > 1e-3 || station < -1e-3 || station > line.frame.length + 1e-3) continue;
    const piece = derived.pieces.find((entry) =>
      entry.lines.some(
        (span) =>
          span.roomId === roomId &&
          span.index === line.index &&
          station >= span.from - 1e-3 &&
          station <= span.to + 1e-3
      )
    );
    if (piece) return piece.width;
  }
  return null;
}

/** Columns the edit didn't move that touch something (a column only resized keeps its contacts). */
export function columnFollowers(before, primary, halfBefore, widthBefore) {
  return before.rooms.flatMap((room) => {
    const after = primary.rooms.find((entry) => entry.id === room.id);
    return (room.columns || []).flatMap((column) => {
      const now = after?.columns?.find((entry) => entry.id === column.id);
      if (!now?.position || !column.position || gap(now.position, column.position) > 1e-9)
        return [];
      const contacts = columnContacts(before, room, column, halfBefore, widthBefore);
      if (!contacts.length) return [];
      const sized = now.width !== column.width || now.height !== column.height;
      return [{ column, now, contacts, sized }];
    });
  });
}
