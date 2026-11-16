import { equalValue } from '../model.js';
import { buildingPlanMaterialCovered } from '../footprints.js';
import { SAME, pointAt } from './grid.js';
import { pieceMaterial } from './material.js';
import { convexPolygonOps as ops } from './polygon-ops.js';

const ANSWER_KEYS = ['values', 'overrides', 'providerOverrides'];
// F4′: a cap lies inside its source's material and has no thickness or height of its own.
const PHYSICAL = ['wall_thickness', 'wall_height'];
const answers = (owner, key) =>
  key === 'overrides'
    ? Object.fromEntries(
        Object.entries(owner?.overrides || {}).filter(([name]) => !PHYSICAL.includes(name))
      )
    : owner?.[key] || {};
const hasRows = (owner) => Object.values(owner?.repeatable || {}).some((rows) => rows?.length);
const hasAnswers = (owner) => ANSWER_KEYS.some((key) => Object.keys(answers(owner, key)).length);

/**
 * A stretch's subject loses nothing when it becomes a cap of `source`: it has no answers or
 * records, or the same answers as the source (sides matched by their answers, not their signs).
 * Thickness and height answers do not count (F4′): a cap has neither of its own.
 */
export function sameCapAnswers(subject, source) {
  if (!subject) return true;
  const owners = [subject, ...(subject.sides || [])];
  if (owners.some(hasRows)) return false;
  if (!owners.some(hasAnswers)) return true;
  const same = (a, b) => ANSWER_KEYS.every((key) => equalValue(answers(a, key), answers(b, key)));
  if (!same(subject, source)) return false;
  return (subject.sides || [])
    .filter(hasAnswers)
    .every((side) => (source?.sides || []).some((other) => same(side, other)));
}

/** The piece's band: from its room face outward by its width. */
function bandOf(line, from, to, width) {
  const out = line.outward * width;
  return [
    pointAt(line.frame, from),
    pointAt(line.frame, to),
    pointAt(line.frame, to, out),
    pointAt(line.frame, from, out),
  ];
}

const onLine = (entry, line) => entry.roomId === line.roomId && entry.index === line.index;

/** An opening of the subject lies on this stretch of the line. */
function hostsOpening(primary, piece, line) {
  const subject = primary.subjects.get(piece.subjectId);
  for (const opening of subject?.openings || []) {
    const anchor = primary.anchors.find((entry) => entry.faceId === opening.faceId);
    const edge = anchor && line.edges.find((entry) => entry.id === anchor.edgeId);
    if (!edge || anchor.roomId !== line.roomId) continue;
    const start = edge.from + opening.from;
    if (Math.min(start + opening.width, piece.line.to) - Math.max(start, piece.line.from) > SAME)
      return true;
  }
  return false;
}

/**
 * Caps (decision F4, variant C2). An exterior remainder of a room line, a stretch that is not the
 * whole line, is a cap when its own wall material lies wholly inside the other walls' material: it
 * has no row and its source supplies the material. Coverage ignores openings (an opening is a hole
 * in a wall, not a missing wall). A remainder stays a wall when it hosts an opening, ends at an
 * explicit cut inside its line, or carries answers that differ from its source's. A whole room line,
 * such as a jog, is always a wall.
 *
 * The source is the piece next to the cap on the same line whose material covers more of it.
 *
 * @returns {{pieces: Array<Object>, caps: Array<Object>}} Pieces without the caps; caps as
 *   `{roomId, index, from, to, source, sourceId, subjectId}` (`subjectId`: the stretch's former
 *   subject, retired in favour of the source on write-back).
 */
export function separateCaps(primary, pieces, lines) {
  const lineOf = (entry) => lines.find((line) => onLine(entry, line));
  const widest = Math.max(0, ...pieces.map((piece) => piece.width || 0));
  const candidates = [];
  for (const piece of pieces) {
    if (piece.partition || piece.exposure !== 'exterior' || !(piece.width > 0)) continue;
    const line = lineOf(piece.line);
    const { from, to } = piece.line;
    const atStart = from <= SAME;
    const atEnd = to >= line.frame.length - SAME;
    if ((atStart && atEnd) || to - from > 2 * widest + SAME) continue;
    const innerCut = line.cuts.some(
      (cut) =>
        (Math.abs(cut.station - from) <= SAME && !atStart) ||
        (Math.abs(cut.station - to) <= SAME && !atEnd)
    );
    if (innerCut || hostsOpening(primary, piece, line)) continue;
    candidates.push({ piece, line, band: bandOf(line, from, to, piece.width) });
  }
  if (!candidates.length) return { pieces, caps: [] };

  const { byPiece } = pieceMaterial(
    { rooms: primary.rooms, partitions: primary.partitions },
    { pieces, caps: [] }
  );
  const covered = (candidate, excluded) =>
    buildingPlanMaterialCovered(
      candidate.band,
      pieces.filter((piece) => !excluded.has(piece)).flatMap((piece) => byPiece.get(piece) || [])
    );
  // First against the walls that are not candidates; a candidate left a wall may then cover
  // another one.
  const all = new Set(candidates.map((candidate) => candidate.piece));
  for (const candidate of candidates) candidate.covered = covered(candidate, all);
  const first = new Set(candidates.filter((c) => c.covered).map((c) => c.piece));
  if (first.size < candidates.length)
    for (const candidate of candidates)
      if (!candidate.covered)
        candidate.covered = covered(candidate, new Set([...first, candidate.piece]));

  const caps = [];
  const capped = new Set();
  const overlap = (piece, band) =>
    ops.area([band]) -
    ops.area(
      (byPiece.get(piece) || []).reduce(
        (rest, clip) => rest.flatMap((part) => ops.difference(part, [clip])),
        [band]
      )
    );
  for (const candidate of candidates) {
    if (!candidate.covered) continue;
    const { piece, line, band } = candidate;
    const neighbours = pieces.filter(
      (other) =>
        other !== piece &&
        !candidates.some((entry) => entry.piece === other && entry.covered) &&
        other.lines.some(
          (entry) =>
            onLine(entry, line) &&
            (Math.abs(entry.to - piece.line.from) <= SAME ||
              Math.abs(entry.from - piece.line.to) <= SAME)
        )
    );
    const source = neighbours
      .map((other) => ({ other, area: overlap(other, band) }))
      .sort(
        (a, b) =>
          b.area - a.area ||
          b.other.line.to - b.other.line.from - (a.other.line.to - a.other.line.from)
      )[0]?.other;
    if (!source) continue;
    const own = primary.subjects.get(piece.subjectId);
    if (own && !sameCapAnswers(own, primary.subjects.get(source.subjectId))) continue;
    capped.add(piece);
    caps.push({
      roomId: line.roomId,
      index: line.index,
      from: piece.line.from,
      to: piece.line.to,
      source,
      sourceId: source.subjectId,
      subjectId: piece.subjectId,
    });
  }
  return { pieces: pieces.filter((piece) => !capped.has(piece)), caps };
}
