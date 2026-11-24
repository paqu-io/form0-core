import { planIssue } from '../model.js';
import { nameOf } from '../wall-children.js';
import { SAME } from './grid.js';
import { edgeLength } from './cut-edges.js';

/**
 * A wall beam's end at its wall's end follows that end (WB8, wall beams 2b, 2026-11-24): a beam
 * over the whole wall stays over the whole wall when the wall gets longer or shorter.
 *
 * Before a geometry command, each beam touching an end of its wall's stretch (its row, the wall
 * piece in that room) is replaced by a point at its free end (`holdWallBeamEnds`), so the
 * command carries that end as it carries a door's and no edit boundary can cut the beam. After
 * the command, `releaseWallBeamEnds` rebuilds the beam from the point to the stretch's new end
 * (both ends: the whole new stretch). Split and Rejoin don't hold: a cut across a beam is still
 * refused (WB8). A beam the move would leave under 1 cm long refuses the edit, named.
 */

const MIN_LENGTH_M = 0.01;

/** The row a carried entry is anchored to, as its stretch on its edge: [from, to]. */
function stretchOf(primary, faceId) {
  const anchor = primary.anchors.find((entry) => entry.faceId === faceId);
  if (anchor) {
    const room = primary.rooms.find((entry) => entry.id === anchor.roomId);
    const edge = room?.edges.find((entry) => entry.id === anchor.edgeId);
    if (!edge) return null;
    return [anchor.from, anchor.to ?? edgeLength(room, edge)];
  }
  const partition = primary.partitions?.find((entry) => entry.faceId === faceId);
  if (!partition || partition.path.length < 2) return null;
  const [a, b] = partition.path;
  return [0, Math.hypot(b.x - a.x, b.y - a.y)];
}

/**
 * Replace each wall beam touching an end of its stretch by a point at its free end.
 * @param {object} primary the floor's primary data (changed in place)
 * @returns {Array<{ entry: object, start: boolean, end: boolean }>} the held beams
 */
export function holdWallBeamEnds(primary) {
  const held = [];
  for (const subject of primary.subjects.values())
    for (const entry of subject.openings || []) {
      if (entry.type !== 'beam') continue;
      const stretch = stretchOf(primary, entry.faceId);
      if (!stretch) continue;
      const start = Math.abs(entry.from - stretch[0]) <= SAME;
      const end = Math.abs(entry.from + entry.width - stretch[1]) <= SAME;
      if (!start && !end) continue;
      // The free end, or the middle when both ends touch (any point on the wall would do).
      const point =
        start && end ? entry.from + entry.width / 2 : start ? entry.from + entry.width : entry.from;
      held.push({ entry, start, end });
      Object.assign(entry, { from: point, width: 0 });
    }
  return held;
}

/**
 * Rebuild the held beams after the command: from their carried point to their stretch's ends.
 * @returns {Array<object>} issues: a beam left too short
 */
export function releaseWallBeamEnds(primary, held) {
  const issues = [];
  for (const { entry, start, end } of held) {
    const stretch = stretchOf(primary, entry.faceId);
    if (!stretch) continue;
    const from = start ? stretch[0] : entry.from;
    const to = end ? stretch[1] : entry.from;
    Object.assign(entry, { from, width: to - from });
    if (to - from < MIN_LENGTH_M)
      issues.push(
        planIssue('beam_too_short', `${nameOf(entry)} would be too short.`, {
          type: 'beam',
          id: entry.id,
        })
      );
  }
  return issues;
}

/**
 * A command that refused a held beam's point (the wall's end moved past the beam's free end) is
 * the beam left too short, as room beams say it (3a-4), not an opening cut by the edit.
 * @returns {Error} the error to throw
 */
export function heldBeamRefusal(error, held) {
  const ids = new Set(
    (error?.issues || []).flatMap((issue) => [...(issue.openingIds || []), issue.subject?.id])
  );
  const entry = held.find(({ entry: beam }) => ids.has(beam.id))?.entry;
  if (!entry) return error;
  const message = `${nameOf(entry)} would be too short.`;
  return Object.assign(new Error(message), {
    issues: [planIssue('beam_too_short', message, { type: 'beam', id: entry.id })],
  });
}
