import { renewBuildingPlanRowIdentities } from '../custom-rows.js';
import { copyBuildingPlanData as copy, equalValue } from '../model.js';
import { SAME } from './grid.js';
import { subjectTangent } from './subject-joins.js';

const refuse = (code, message, details = {}) => {
  throw Object.assign(new Error(message), { issues: [{ code, message, ...details }] });
};

/** The room-line span of a position anchored to a row: `from` metres from its edge start. */
export function anchoredSpan(context, faceId, from, width) {
  const anchor = context.anchorByFace.get(faceId);
  const located = anchor && context.edgeLine.get(`${anchor.roomId}:${anchor.edgeId}`);
  if (!located) return null;
  const start = located.edge.from + from;
  return { key: `${anchor.roomId}:${located.line.index}`, from: start, to: start + width };
}

const entryOn = (piece, key) => piece.lines.find((e) => `${e.roomId}:${e.index}` === key);

/** Host piece of each opening; an opening may not cross a piece boundary. */
function placeOpenings(context, subject, pieces) {
  const placed = new Map();
  for (const opening of subject.openings) {
    const span = anchoredSpan(context, opening.faceId, opening.from, opening.width);
    const subjectRef = { type: opening.type, id: opening.id };
    if (!span) {
      context.issues.push({ code: 'unanchored_opening', subject: subjectRef });
      placed.set(opening.id, pieces[0]);
      continue;
    }
    const host = pieces.find((piece) => {
      const entry = entryOn(piece, span.key);
      return entry && entry.from - SAME <= span.from && span.to <= entry.to + SAME;
    });
    if (host) {
      placed.set(opening.id, host);
      continue;
    }
    const crossed = pieces.some((piece) => {
      const entry = entryOn(piece, span.key);
      return entry && Math.min(entry.to, span.to) - Math.max(entry.from, span.from) > SAME;
    });
    if (crossed)
      refuse(
        'opening_crosses_split',
        'A required room-adjacency boundary passes through an opening. Move the opening or adjust the room.',
        { subject: subjectRef, openingIds: [opening.id] }
      );
    context.issues.push({ code: 'opening_outside_wall', subject: subjectRef });
    placed.set(opening.id, pieces[0]);
  }
  return placed;
}

/** The piece holding the start of the subject's reference row keeps the subject. */
function referencePiece(context, subject, pieces) {
  const anchor = context.anchorByFace.get(subject.referenceFaceId);
  const span = anchor && anchoredSpan(context, anchor.faceId, anchor.from, 0);
  const held =
    span &&
    pieces.find((piece) => {
      const entry = entryOn(piece, span.key);
      return entry && span.from > entry.from - SAME && span.from < entry.to - SAME;
    });
  return held || pieces[0];
}

/**
 * A subject covering several pieces divides. The piece holding its reference span keeps the
 * subject; every other piece gets a new subject copying the answers, the side answers (new side
 * IDs) and the custom rows (new row IDs). Openings follow the piece that contains them.
 */
export function divideSubjects(context) {
  const bySubject = new Map();
  for (const piece of context.pieces) {
    if (!bySubject.has(piece.subjectId)) bySubject.set(piece.subjectId, []);
    bySubject.get(piece.subjectId).push(piece);
  }
  for (const [id, pieces] of bySubject) {
    if (pieces.length < 2) continue;
    const subject = context.subjects.get(id);
    const placed = placeOpenings(context, subject, pieces);
    const kept = referencePiece(context, subject, pieces);
    const source = copy(subject);
    const division = {
      splitFromWallId: source.lineage?.splitFromWallId || source.id,
      dividedFromWallId: source.id,
      automaticDivision: 'adjacency',
    };
    const subjectIds = [];
    // New pieces are numbered in order along the source's axis, as today (W3.1, W3.2, ...).
    const tangent = subjectTangent(context, source) || { x: 0, y: 0 };
    const station = (piece) =>
      ((piece.axis.start.x + piece.axis.end.x) * tangent.x +
        (piece.axis.start.y + piece.axis.end.y) * tangent.y) /
      2;
    for (const piece of [...pieces].sort((a, b) => station(a) - station(b))) {
      const onPiece = (opening) => placed.get(opening.id) === piece;
      let target = subject;
      if (piece !== kept) {
        target = { ...copy(source), id: context.createId() };
        delete target.autoLabel;
        target.segmentId = context.createId();
        target.referenceFaceId = null;
        target.sides = target.sides.map((side) => ({ ...side, id: context.createId() }));
        renewBuildingPlanRowIdentities(target, context.createId);
        for (const side of target.sides) renewBuildingPlanRowIdentities(side, context.createId);
        context.subjects.set(target.id, target);
        context.children.set(target.id, source.id);
      }
      target.lineage = { ...source.lineage, ...division };
      delete target.lineage.thicknessProfile;
      target.openings = (piece === kept ? subject : source).openings.filter(onPiece);
      piece.subjectId = target.id;
      subjectIds.push(target.id);
    }
    context.divisions.push({ source, subjectIds });
  }
}

/**
 * A subject left without a piece retires only when nothing would be lost: no openings, no
 * custom rows, and either no answers or a compatible survivor of the same split root (thickness
 * and height overrides of an automatic piece do not migrate). Otherwise the edit is refused.
 */
export function retireSubjects(context) {
  const live = new Set(
    [...context.pieces, ...context.partitionPieces].map((piece) => piece.subjectId)
  );
  for (const subject of [...context.subjects.values()]) {
    if (live.has(subject.id)) continue;
    if (subject.openings.length)
      refuse(
        'opening_crosses_edit_boundary',
        'An opening occupies the automatic wall portion removed by this edit.',
        {
          subject: { type: subject.openings[0].type, id: subject.openings[0].id },
          openingIds: subject.openings.map((opening) => opening.id),
        }
      );
    const owners = [subject, ...(subject.sides || [])];
    const hasRows = owners.some((owner) =>
      Object.values(owner.repeatable || {}).some((rows) => rows.length)
    );
    const hasAnswers = owners.some((owner) =>
      ['overrides', 'providerOverrides', 'values'].some(
        (key) => Object.keys(owner[key] || {}).length
      )
    );
    const survivor = hasAnswers ? retirementSurvivor(context, subject, live) : null;
    if (hasRows || (hasAnswers && !survivor))
      refuse(
        'wall_retirement_conflict',
        'This edit removes a physical piece with unresolved answers or records. Resolve them before continuing.',
        { subject: { type: 'wall', id: subject.id } }
      );
    for (const profile of context.profiles)
      if (profile.sourceId === subject.id) profile.sourceId = survivor?.id ?? null;
    context.subjects.delete(subject.id);
    if (survivor) context.alias.set(subject.id, survivor.id);
    context.retired.push(subject.id);
  }
}

function retirementSurvivor(context, subject, live) {
  const origin = subject.lineage?.splitFromWallId || subject.lineage?.jogOriginWallId;
  if (!origin) return null;
  const automatic =
    subject.lineage?.automaticDivision && !subject.lineage.explicitPhysicalSeparation;
  const kept = (owner) =>
    Object.fromEntries(
      Object.entries(owner.overrides || {}).filter(
        ([key]) => !automatic || !['wall_thickness_m', 'wall_height_m'].includes(key)
      )
    );
  const same = (a, b) =>
    equalValue(kept(a), kept(b)) &&
    equalValue(a.providerOverrides || {}, b.providerOverrides || {}) &&
    equalValue(a.values || {}, b.values || {});
  return [...context.subjects.values()].find(
    (other) =>
      other !== subject &&
      live.has(other.id) &&
      (other.id === origin || other.lineage?.splitFromWallId === origin) &&
      same(other, subject) &&
      (subject.sides || []).every((side) => {
        const target = other.sides?.find((entry) => entry.sign === side.sign);
        return target && same(target, side);
      })
  );
}
