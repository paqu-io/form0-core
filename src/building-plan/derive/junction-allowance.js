import { SAME, pointAt } from './grid.js';

const dot = (a, b) => a.x * b.x + a.y * b.y;

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
 * Whether the other room's wall at a moved contact's end reaches the moving room's new face: its
 * corner does (the junction fills the contact's width). A stationary other room that runs on, or
 * steps to its own continuation, does not: the wall beyond the end still meets this room's line
 * where it was (a thickness change, a widened wall).
 */
const reachesMovedFace = (other) => !other.stationary || other.situation.kind === 'slide';

/**
 * How far a room's line must reach past a moved contact's end so its clear space stays out of the
 * other room's wall material there: the other room's adjoining wall, measured along this line
 * (today's junction allowance), or the contact's own width when the other room jogs there too.
 */
export function junctionAllowance(derived, line, other, contactWidth) {
  if (!other || !reachesMovedFace(other)) return 0;
  if (other.situation.kind === 'straight') return contactWidth;
  const adjoining =
    other.situation.kind === 'shift' ? other.situation.jog : other.situation.adjoining;
  const width = pieceAtLineEnd(derived, adjoining, !other.atEnd)?.width ?? 0;
  const cos = Math.abs(dot(line.frame.tangent, adjoining.frame.tangent));
  const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
  return sin > 1e-9 && width > 0 ? (width + contactWidth * cos) / sin : 0;
}

/**
 * The return a room makes against the other room's adjoining wall at a moved contact's end: the
 * line parallel to that wall at its width outside it (where this room's clear space must stop),
 * as a station on this line and a direction. Null when the other room has no adjoining wall there.
 */
export function junctionReturn(derived, line, other) {
  if (!other || other.situation.kind === 'straight' || !reachesMovedFace(other)) return null;
  const adjoining =
    other.situation.kind === 'shift' ? other.situation.jog : other.situation.adjoining;
  const width = pieceAtLineEnd(derived, adjoining, !other.atEnd)?.width ?? 0;
  if (!(width > 0)) return null;
  const { frame } = adjoining;
  const base = pointAt(frame, 0, adjoining.outward * width);
  const det = line.frame.tangent.x * frame.tangent.y - line.frame.tangent.y * frame.tangent.x;
  if (Math.abs(det) <= 1e-9) return null;
  const t =
    ((base.x - line.frame.start.x) * frame.tangent.y -
      (base.y - line.frame.start.y) * frame.tangent.x) /
    det;
  return { station: t, direction: frame.tangent };
}
