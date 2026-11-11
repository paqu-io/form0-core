import { equalValue } from '../model.js';
import { mergeWallAnswers } from '../wall-merge.js';
import { createWallSides } from '../wall-sides.js';
import { SAME } from './grid.js';
import { rowTangent } from './frames.js';

const LABEL = /^W\d+(?:\.\d+)*$/;
const labelParts = (label) =>
  LABEL.test(label || '') ? label.slice(1).split('.').map(Number) : null;

/** Lower label first (W2 before W7, W3 before W12, W3 before W3.1), then lower ID. */
export function compareSubjects(a, b) {
  const [x, y] = [labelParts(a.autoLabel), labelParts(b.autoLabel)];
  if (x && !y) return -1;
  if (y && !x) return 1;
  if (x && y)
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const difference = (x[i] ?? -1) - (y[i] ?? -1);
      if (difference) return difference;
    }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The anchors on the room lines a piece faces that overlap its span. */
export function pieceAnchors(context, piece) {
  const found = [];
  for (const entry of piece.lines)
    for (const anchor of context.lines.get(`${entry.roomId}:${entry.index}`)?.anchors || [])
      if (Math.min(anchor.to, entry.to) - Math.max(anchor.from, entry.from) > SAME)
        found.push(anchor);
  return found;
}

/** Canonical direction of a subject, read from its reference row in the primary geometry. */
export function subjectTangent(context, subject) {
  const anchor = context.anchorByFace.get(subject.referenceFaceId);
  return anchor ? rowTangent(context.rooms, anchor) : null;
}

/** 1 when two subjects run the same way, -1 when they run opposite (side signs then swap). */
export function relativeDirection(context, a, b) {
  const [x, y] = [a, b].map((subject) => subjectTangent(context, subject));
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

/**
 * Give every boundary piece its subject. A piece whose rows belong to two subjects is an unbound
 * contact: the subjects join. The survivor is the subject of a preferred room (the command's
 * choice), else the lower label. A piece without anchors gets a new subject.
 */
export function resolvePieceSubjects(context) {
  const parent = new Map();
  const find = (id) => {
    while (parent.get(id) !== id) id = parent.get(id);
    return id;
  };
  const candidates = context.pieces.map((piece) => {
    const ids = [];
    for (const anchor of pieceAnchors(context, piece)) {
      const id = context.resolve(anchor.subjectId);
      if (!context.subjects.has(id)) {
        context.issues.push({ code: 'dangling_anchor', faceId: anchor.faceId, subjectId: id });
        continue;
      }
      if (!ids.includes(id)) ids.push(id);
      if (!parent.has(id)) parent.set(id, id);
    }
    for (const id of ids.slice(1)) parent.set(find(id), find(ids[0]));
    return ids;
  });
  const groups = new Map();
  for (const id of parent.keys()) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(context.subjects.get(id));
  }
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const preferred = members.filter((subject) =>
      context.preferredRoomIds.includes(context.anchorByFace.get(subject.referenceFaceId)?.roomId)
    );
    const [survivor] = [...(preferred.length ? preferred : members)].sort(compareSubjects);
    for (const other of members.filter((subject) => subject !== survivor).sort(compareSubjects))
      absorbSubject(context, survivor, other);
  }
  context.pieces.forEach((piece, index) => {
    const [id] = candidates[index];
    piece.subjectId = id ? context.resolve(id) : newSubject(context).id;
  });
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
    compareSubjects(a, b);
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
