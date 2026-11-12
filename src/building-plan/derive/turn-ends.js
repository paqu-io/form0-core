import { SAME, lineFrame, offset, pointAt } from './grid.js';

/** Intersection of the lines through p (direction u) and q (direction v), or null if parallel. */
function intersect(p, u, q, v) {
  const det = u.x * v.y - u.y * v.x;
  if (Math.abs(det) <= 1e-12) return null;
  const t = ((q.x - p.x) * v.y - (q.y - p.y) * v.x) / det;
  return { x: p.x + u.x * t, y: p.y + u.y * t };
}

/**
 * Decision D (pivot bend): a stretch turned by a corner drag turns about a point next to the
 * corner room's fixed end. Where the room's line goes on past such an end, the line bends where
 * the moved line crosses the old one, if that lies within the wall's width of the end (a square
 * jog there would be a sliver). Where the line already bent there and the moved line now lies on
 * the line beyond, the end becomes a point of one straight line again.
 *
 * @param {Object} run A run of `editRuns` with its prepared ends.
 * @param {boolean} atEnd The run's end (else its start).
 * @returns {Object|null} A `bend` end plan for `moveRoomStretch`, or null for the usual plan.
 */
export function planTurnedEnd(run, atEnd) {
  const { line, situation } = run.ends[atEnd ? 1 : 0];
  const map = run.maps?.[atEnd ? 1 : 0] || run.map;
  if (!map) return null;
  const moved = lineFrame(map(line.frame.start), map(line.frame.end));
  if (!moved) return null;
  if (situation.kind === 'slide') {
    const { start, end } = situation.adjoining.frame;
    const straight = Math.abs(offset(moved, start)) <= SAME && Math.abs(offset(moved, end)) <= SAME;
    return straight ? { type: 'bend', station: null } : null;
  }
  if (situation.kind !== 'straight') return null;
  const station = atEnd ? run.to : run.from;
  const corner = pointAt(line.frame, station);
  const crossing = intersect(moved.start, moved.tangent, line.frame.start, line.frame.tangent);
  if (!crossing) return null;
  const distance = Math.hypot(crossing.x - corner.x, crossing.y - corner.y);
  return distance <= (run.width ?? 0) + SAME ? { type: 'bend', station, point: crossing } : null;
}
