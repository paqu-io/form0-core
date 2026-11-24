import { copyBuildingPlanData as copy, equalValue } from '../model.js';
import { renewBuildingPlanRowIdentities } from '../custom-rows.js';
import { SAME, along, lineFrame, pointAt } from './grid.js';

/**
 * Wall beams through a Split (2c, decided 2026-11-24, option b): a cut that crosses no door or
 * window divides the wall, and every beam across it, as a wall divides: the part on the piece
 * that keeps the wall's identity keeps the beam's (else the first part along the wall); every
 * other part is a new beam with the same size, height and answers (custom rows with new IDs) and
 * no name, so it gets the next B#. Rejoin makes two beams meeting at the cut one again when their
 * size, height and answers match; the one that belonged to the wall the Split divided survives.
 */

const NAME = 'wall_beam_identifier';

/** A new part of a carried beam entry: `from`, `width` along its row's line. */
export function beamPart(entry, from, width, createId) {
  const part = { ...copy(entry), id: createId(), from, width };
  part.values = { ...(part.values || {}), [NAME]: null };
  renewBuildingPlanRowIdentities(part, createId);
  return part;
}

/**
 * Divide each beam of `subject` that crosses its pieces (see `divideSubjects`). `spanOf`: an
 * entry's span on its room line `{ key, from, to }` (`anchoredSpan`); `entryOn`: a piece's stretch
 * of that line.
 */
export function divideBeamsOnPieces(subject, pieces, kept, { spanOf, entryOn, createId }) {
  const parts = [];
  for (const beam of subject.openings) {
    if (beam.type !== 'beam') continue;
    const span = spanOf(beam);
    if (!span) continue;
    const covered = pieces
      .map((piece) => ({ piece, entry: entryOn(piece, span.key) }))
      .filter(
        ({ entry }) => entry && Math.min(entry.to, span.to) - Math.max(entry.from, span.from) > SAME
      )
      .sort((a, b) => a.entry.from - b.entry.from);
    if (covered.length < 2) continue;
    const base = span.from - beam.from;
    const keeper = covered.find(({ piece }) => piece === kept) || covered[0];
    for (const { piece, entry } of covered) {
      const from = Math.max(entry.from, span.from) - base;
      const width = Math.min(entry.to, span.to) - base - from;
      if (piece === keeper.piece) Object.assign(beam, { from, width });
      else parts.push(beamPart(beam, from, width, createId));
    }
  }
  subject.openings.push(...parts);
}

/** A free wall portion cut `at` metres along it: a beam across the cut divides (see above). */
export function divideBeamsAtCut(subject, faceId, nextFaceId, at, createId) {
  const parts = [];
  for (const beam of subject.openings) {
    if (beam.type !== 'beam' || beam.faceId !== faceId) continue;
    if (!(beam.from < at - SAME && beam.from + beam.width > at + SAME)) continue;
    const part = beamPart(beam, 0, beam.from + beam.width - at, createId);
    part.faceId = nextFaceId;
    beam.width = at - beam.from;
    parts.push(part);
  }
  subject.openings.push(...parts);
}

/** A carried entry's ends on the floor, from its row (a room edge or a free wall portion). */
function endsOf(primary, entry) {
  const anchor = primary.anchors.find((item) => item.faceId === entry.faceId);
  let frame = null;
  if (anchor) {
    const room = primary.rooms.find((item) => item.id === anchor.roomId);
    const edge = room?.edges.find((item) => item.id === anchor.edgeId);
    const vertex = (id) => room.vertices.find((item) => item.id === id);
    frame = edge && lineFrame(vertex(edge.startId), vertex(edge.endId));
  } else {
    const partition = primary.partitions.find((item) => item.faceId === entry.faceId);
    frame = partition && lineFrame(partition.path[0], partition.path[1]);
  }
  return (
    frame && { frame, ends: [pointAt(frame, entry.from), pointAt(frame, entry.from + entry.width)] }
  );
}

const same = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= SAME;
const answers = (entry) => {
  const values = { ...(entry.values || {}) };
  delete values[NAME];
  return values;
};
const matching = (a, b) =>
  equalValue(
    [a.crossWidth, a.depth, a.underside, answers(a), a.repeatable || {}],
    [b.crossWidth, b.depth, b.underside, answers(b), b.repeatable || {}]
  );

/**
 * After a Rejoin, beams of `subject` meeting end to end become one when they match. `keepIds`:
 * the beams of the wall the Split divided, which survive a merge.
 */
export function mergeMeetingBeams(primary, subject, keepIds) {
  let merged = true;
  while (merged) {
    merged = false;
    const beams = subject.openings.filter((entry) => entry.type === 'beam');
    for (const a of beams) {
      const placeA = endsOf(primary, a);
      const b =
        placeA &&
        beams.find((other) => {
          if (other === a || !matching(a, other)) return false;
          const placeB = endsOf(primary, other);
          return placeB && placeA.ends.some((p) => placeB.ends.some((q) => same(p, q)));
        });
      if (!b) continue;
      const [kept, gone] = keepIds.has(b.id) && !keepIds.has(a.id) ? [b, a] : [a, b];
      const { frame } = endsOf(primary, kept);
      const stations = [...endsOf(primary, kept).ends, ...endsOf(primary, gone).ends].map((p) =>
        along(frame, p)
      );
      const from = Math.min(...stations);
      Object.assign(kept, { from, width: Math.max(...stations) - from });
      subject.openings = subject.openings.filter((entry) => entry !== gone);
      merged = true;
      break;
    }
  }
}
