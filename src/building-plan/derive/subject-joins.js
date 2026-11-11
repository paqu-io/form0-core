import { equalValue } from '../model.js';
import { mergeWallAnswers } from '../wall-merge.js';
import { createWallSides } from '../wall-sides.js';
import { SAME } from './grid.js';
import { rowTangent } from './frames.js';

const LABEL = /^W\d+(?:\.\d+)*$/;
const labelParts = (label) =>
  LABEL.test(label || '') ? label.slice(1).split('.').map(Number) : null;

/** A subject's label; a copy made by this write-back goes by its source's label. */
const labelOf = (context, subject) =>
  subject.autoLabel ?? context.original.get(context.children.get(subject.id))?.autoLabel;

/** Lower label first (W2 before W7, W3 before W12, W3 before W3.1), then lower ID. */
export function compareSubjects(context, a, b) {
  const [x, y] = [labelParts(labelOf(context, a)), labelParts(labelOf(context, b))];
  if (x && !y) return -1;
  if (y && !x) return 1;
  if (x && y)
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const difference = (x[i] ?? -1) - (y[i] ?? -1);
      if (difference) return difference;
    }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The anchors on the room lines a piece faces that overlap its span, with their room. */
export function pieceAnchors(context, piece) {
  const found = [];
  for (const entry of piece.lines)
    for (const anchor of context.lines.get(`${entry.roomId}:${entry.index}`)?.anchors || [])
      if (Math.min(anchor.to, entry.to) - Math.max(anchor.from, entry.from) > SAME)
        found.push({ ...anchor, roomId: entry.roomId });
  return found;
}

/** Canonical direction of a subject, read from its reference row in the primary geometry. */
export function subjectTangent(context, subject) {
  const anchor = context.anchorByFace.get(subject.referenceFaceId);
  return anchor ? rowTangent(context.rooms, anchor) : null;
}

/**
 * 1 when two subjects run the same way, -1 when they run opposite (side signs then swap). Each
 * subject's signs are defined against its basis: its reference row's direction, or its source's
 * for a copy made by this write-back.
 */
export function relativeDirection(context, a, b) {
  const [x, y] = [a, b].map((subject) => context.basis.get(subject.id));
  return x && y && x.x * y.x + x.y * y.y < 0 ? -1 : 1;
}

/**
 * Join `other` into `survivor`: every answer, side answer and custom row survives, or the edit is
 * refused with today's codes. Openings, rows (through the pieces) and supplied profiles move.
 */
export function absorbSubject(context, survivor, other) {
  const direction = relativeDirection(context, survivor, other);
  mergeWallAnswers(survivor, other, direction);
  survivor.lineage = {
    ...(survivor.lineage || {}),
    mergedWallIds: [...(survivor.lineage?.mergedWallIds || []), other.id],
  };
  survivor.openings.push(...other.openings);
  for (const profile of context.profiles)
    if (profile.sourceId === other.id) {
      profile.sourceId = survivor.id;
      profile.sideSign *= direction;
    }
  context.alias.set(other.id, survivor.id);
  context.subjects.delete(other.id);
  context.joins.push({ survivorId: survivor.id, absorbedId: other.id });
}

function newSubject(context) {
  const { createId } = context;
  const subject = {
    id: createId(),
    overrides: {},
    properties: {},
    provenance: {},
    values: {},
    referenceFaceId: null,
    segmentId: createId(),
    segmentFlags: {},
    lastWidth: 0,
    sides: createWallSides(createId).map(({ roomId, ...side }) => side),
    openings: [],
  };
  context.subjects.set(subject.id, subject);
  context.created.push(subject.id);
  return subject;
}

/** The subjects anchored on each boundary piece, with the room each is anchored from. */
export function collectPieceSubjects(context) {
  for (const piece of context.pieces) {
    piece.anchored = [];
    for (const anchor of pieceAnchors(context, piece)) {
      if (!context.subjects.has(anchor.subjectId)) {
        context.issues.push({ code: 'dangling_anchor', faceId: anchor.faceId });
        continue;
      }
      if (!piece.anchored.some((entry) => entry.subjectId === anchor.subjectId))
        piece.anchored.push({ subjectId: anchor.subjectId, roomId: anchor.roomId });
    }
  }
}

/**
 * After divisions every subject lies on one piece. A piece whose rows belong to two subjects is
 * a new contact: they join. The survivor is a wall that existed before the edit and lies whole on
 * the piece, then one that existed, then the subject of a preferred room (the room the command did
 * not move), then the lower label. A piece without anchors gets a new subject.
 */
export function joinPieceSubjects(context) {
  const rank = ({ subject }) =>
    context.original.has(subject.id) ? (context.divided.has(subject.id) ? 1 : 2) : 0;
  const preferred = ({ roomId }) => Number(context.preferredRoomIds.includes(roomId));
  const order = (a, b) =>
    rank(b) - rank(a) ||
    preferred(b) - preferred(a) ||
    compareSubjects(context, a.subject, b.subject);
  for (const piece of context.pieces) {
    const members = [];
    for (const { subjectId, roomId } of piece.anchored) {
      const subject = context.subjects.get(context.resolve(subjectId));
      if (subject && !members.some((member) => member.subject === subject))
        members.push({ subject, roomId });
    }
    if (!members.length) {
      piece.subjectId = newSubject(context).id;
      continue;
    }
    const [survivor, ...others] = members.sort(order);
    for (const { subject } of others) absorbSubject(context, survivor.subject, subject);
    piece.subjectId = survivor.subject.id;
  }
}

const root = (subject) => subject.lineage?.splitFromWallId || subject.id;
const automatic = (a, b) =>
  a.lineage?.automaticDivision && (b.lineage?.automaticDivision || root(a) === root(b));
const SUBJECT_KEYS = ['overrides', 'providerOverrides', 'values', 'repeatable'];
const sameAnswers = (a, b) => SUBJECT_KEYS.every((key) => equalValue(a[key] || {}, b[key] || {}));

/** Where two pieces meet on every room line they face, with no explicit cut there. */
function touching(context, p, q) {
  if (p.lines.length !== q.lines.length) return false;
  return p.lines.every((entry) => {
    const other = q.lines.find(
      (line) => line.roomId === entry.roomId && line.index === entry.index
    );
    if (!other) return false;
    const station =
      Math.abs(entry.to - other.from) <= SAME
        ? entry.to
        : Math.abs(other.to - entry.from) <= SAME
          ? entry.from
          : null;
    const line = context.lines.get(`${entry.roomId}:${entry.index}`);
    return station != null && !line.cuts.some((cut) => Math.abs(cut.station - station) <= SAME);
  });
}

/**
 * Automatic divisions join again when they meet with the same rooms, no explicit cut between
 * them, the same width and the same answers (today's rule). The split root survives, then a
 * subject that already existed, then the lower label.
 */
export function rejoinAutomaticPieces(context) {
  const order = (a, b) =>
    Number(b.id === b.lineage?.splitFromWallId) - Number(a.id === a.lineage?.splitFromWallId) ||
    Number(context.original.has(b.id)) - Number(context.original.has(a.id)) ||
    compareSubjects(context, a, b);
  for (let joined = true; joined; ) {
    joined = false;
    for (const p of context.pieces) {
      for (const q of context.pieces) {
        if (p === q || p.subjectId === q.subjectId || p.width !== q.width) continue;
        if (p.thickness !== q.thickness || !touching(context, p, q)) continue;
        const [a, b] = [p, q].map((piece) => context.subjects.get(piece.subjectId));
        if (!(automatic(a, b) || automatic(b, a)) || !sameAnswers(a, b)) continue;
        const direction = relativeDirection(context, a, b);
        const sidesMatch = a.sides.every((side) => {
          const match = b.sides.find((entry) => entry.sign === side.sign * direction);
          return match && sameAnswers(side, match);
        });
        if (!sidesMatch) continue;
        const [survivor, other] = [a, b].sort(order);
        absorbSubject(context, survivor, other);
        for (const entry of p.lines) {
          const line = q.lines.find((x) => x.roomId === entry.roomId && x.index === entry.index);
          entry.from = Math.min(entry.from, line.from);
          entry.to = Math.max(entry.to, line.to);
        }
        for (const piece of context.pieces)
          if (piece.subjectId === other.id) piece.subjectId = survivor.id;
        context.pieces.splice(context.pieces.indexOf(q), 1);
        joined = true;
        break;
      }
      if (joined) break;
    }
  }
}
