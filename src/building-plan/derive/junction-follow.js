import { SAME, along, pointAt } from './grid.js';
import { depth, endSituation, pieceAt, pieceAtLineEnd } from './face-plans.js';

const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Intersection of the lines through p (direction u) and q (direction v), or null. */
function intersect(p, u, q, v) {
  const det = u.x * v.y - u.y * v.x;
  if (Math.abs(det) <= 1e-12) return null;
  const t = ((q.x - p.x) * v.y - (q.y - p.y) * v.x) / det;
  return { x: p.x + u.x * t, y: p.y + u.y * t };
}

/**
 * Shared extents transform together (corner contract): when a moved stretch's corner slides along
 * a line that is a shared wall, the neighbour across that wall keeps meeting the wall's end. The
 * junction it made there (a cap and a jog to its continuation) moves along the wall by the same
 * amount, when its continuation would otherwise lie on or past the moved room's face; nothing else
 * of the neighbour moves.
 *
 * A run may carry its own `delta` (a thickness change moves each stretch by its own amount).
 * `across`: the rooms across the dragged wall, which never follow.
 *
 * @returns {Array<Object>} Runs for `editRuns` with their ends given (`fixedEnds`).
 */
export function junctionFollowers(derived, runs, delta, across = []) {
  const moving = runs.filter((run) => !run.stationary);
  // A room across the dragged wall is its partner, never a junction follower: it moves with the
  // wall or stays (widen, detach), even where it also wraps round the corner.
  const rooms = new Set([...moving.map((run) => run.roomId), ...across]);
  const extra = [];
  for (const run of moving)
    for (const end of run.ends) {
      if (end.situation.kind !== 'slide') continue;
      const adjoining = end.situation.adjoining;
      // The adjoining line starts at the corner when the stretch ends there.
      const corner = end.atEnd ? adjoining.frame.start : adjoining.frame.end;
      const piece = pieceAtLineEnd(derived, adjoining, !end.atEnd);
      const other = piece?.lines.find((entry) => entry.roomId !== run.roomId);
      if (!other || rooms.has(other.roomId)) continue;
      const line = derived.lines.find(
        (entry) => entry.roomId === other.roomId && entry.index === other.index
      );
      const near = [other.from, other.to].sort(
        (a, b) => gap(pointAt(line.frame, a), corner) - gap(pointAt(line.frame, b), corner)
      )[0];
      const atEnd = line.frame.length - near < near;
      const situation = endSituation(derived.lines, derived.caps, line, near, atEnd);
      if (situation.kind !== 'shift') continue;
      // Only when the neighbour's continuation would lie on or past the moved room's face; a
      // continuation short of it holds and meets the lengthened wall as a contact (R1, F3).
      if (-depth(line, situation.continuation) < piece.width - SAME) continue;
      const start = pointAt(run.line.frame, end.atEnd ? run.to : run.from);
      const step = run.delta || delta;
      const moved = { x: start.x + step.x, y: start.y + step.y };
      const next = intersect(moved, run.line.frame.tangent, corner, adjoining.frame.tangent);
      if (!next) continue;
      const shift = along(line.frame, next) - along(line.frame, corner);
      if (Math.abs(shift) <= SAME) continue;
      const keep = situation.jog.edges
        .filter((edge) => {
          const owner = pieceAt(derived, situation.jog, (edge.from + edge.to) / 2);
          return owner?.subjectId && owner.exposure === 'exterior';
        })
        .map((edge) => edge.id);
      const shifted = { type: 'shift', station: (atEnd ? line.frame.length : 0) + shift, keep };
      // The stretch is the whole line, moved by nothing: only the junction at its end moves (a
      // zero jog at the other end merges away).
      const still = { type: 'jog', station: atEnd ? 0 : line.frame.length };
      extra.push({
        roomId: line.roomId,
        line,
        from: 0,
        to: line.frame.length,
        fixedEnds: atEnd ? [still, shifted] : [shifted, still],
      });
    }
  return extra;
}
