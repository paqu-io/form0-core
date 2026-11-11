import { SAME, along, offset, parallelTo, pointAt } from './grid.js';
import { anchorAt } from './line-spans.js';

const dot = (a, b) => a.x * b.x + a.y * b.y;

/** Unit vector from a room line into its room. */
export const inward = (line) => ({
  x: -line.outward * line.frame.normal.x,
  y: -line.outward * line.frame.normal.y,
});

const roomLinesOf = (lines, roomId) =>
  lines.filter((line) => line.roomId === roomId).sort((a, b) => a.index - b.index);
const neighbourLine = (lines, line, step) => {
  const own = roomLinesOf(lines, line.roomId);
  return own[(own.indexOf(line) + step + own.length * 2) % own.length];
};

/**
 * How a moved stretch of a room line reconnects at one end (`atEnd`: its end, else its start):
 *
 * - `straight`: the line continues past the stretch, which then needs a jog.
 * - `slide`: the line turns at a corner there; the corner slides along the adjoining line.
 * - `shift`: the line ends at a right-angle jog to a parallel continuation in the same direction
 *   (a step made by an earlier edit); the jog is placed again, or removed.
 *
 * Caps between the stretch end and the line end move with the stretch (`reach`): they are the
 * junction a previous edit left, not walls of their own.
 */
export function endSituation(lines, caps, line, station, atEnd) {
  const length = line.frame.length;
  const onLine = caps.filter((cap) => cap.roomId === line.roomId && cap.index === line.index);
  let reach = station;
  for (let guard = 0; guard < onLine.length; guard++) {
    const cap = onLine.find((entry) =>
      atEnd
        ? Math.abs(entry.from - reach) <= SAME && entry.to > reach
        : Math.abs(entry.to - reach) <= SAME && entry.from < reach
    );
    if (!cap) break;
    reach = atEnd ? cap.to : cap.from;
  }
  if (atEnd ? reach < length - SAME : reach > SAME) return { kind: 'straight', reach: station };
  const step = atEnd ? 1 : -1;
  const next = neighbourLine(lines, line, step);
  const beyond = neighbourLine(lines, line, 2 * step);
  const square =
    Math.abs(along(line.frame, next.frame.start) - along(line.frame, next.frame.end)) <= SAME;
  const continues =
    beyond !== line &&
    dot(line.frame.tangent, beyond.frame.tangent) > 0 &&
    parallelTo(line.frame, beyond.frame.start, beyond.frame.end);
  if (square && continues) return { kind: 'shift', reach, jog: next, continuation: beyond };
  return { kind: 'slide', reach, adjoining: next };
}

/** Offset into the room of a parallel line, measured from `line`. */
export const depth = (line, other) => -line.outward * offset(line.frame, other.frame.start);

/** The current piece (or cap source) of a room line at one of its ends. */
export function pieceAtLineEnd(derived, line, atEnd) {
  const station = atEnd ? line.frame.length : 0;
  const touches = (entry) =>
    entry.roomId === line.roomId &&
    entry.index === line.index &&
    Math.abs((atEnd ? entry.to : entry.from) - station) <= SAME;
  return (
    derived.pieces.find((piece) => piece.lines.some(touches)) ||
    derived.caps.find(touches)?.source ||
    null
  );
}

/**
 * How far a room's line must reach past a moved contact's end so its clear space stays out of the
 * other room's wall material there: the other room's adjoining wall, measured along this line
 * (today's junction allowance), or the contact's own width when the other room jogs there too.
 */
export function junctionAllowance(derived, line, other, contactWidth) {
  if (!other) return 0;
  if (other.situation.kind === 'straight') return contactWidth;
  const adjoining =
    other.situation.kind === 'shift' ? other.situation.jog : other.situation.adjoining;
  const width = pieceAtLineEnd(derived, adjoining, !other.atEnd)?.width ?? 0;
  const cos = Math.abs(dot(line.frame.tangent, adjoining.frame.tangent));
  const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
  return sin > 1e-9 && width > 0 ? (width + contactWidth * cos) / sin : 0;
}

/** The subject anchored on a room line just inside a station (towards `towards`). */
export function subjectNear(line, station, towards) {
  const probe = station + Math.sign(towards - station) * SAME * 2;
  return anchorAt(line, probe - SAME, probe + SAME) || null;
}

/** The current piece covering a point of a room line, if any. */
export function pieceAt(derived, line, station) {
  return derived.pieces.find((piece) =>
    piece.lines.some(
      (entry) =>
        entry.roomId === line.roomId &&
        entry.index === line.index &&
        entry.from - SAME <= station &&
        station <= entry.to + SAME
    )
  );
}

export { pointAt };
