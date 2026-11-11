import { SAME, pointAt } from './grid.js';
import { moveRoomStretch } from './boundary-edits.js';
import { remapRoomSpans } from './span-remap.js';
import { deriveBuildingPlanPieces } from './pieces.js';
import { anchorAt } from './line-spans.js';
import { endSituation, planEnd } from './face-plans.js';

/** The physical point of a run end. */
const endPoint = (run, atEnd) => pointAt(run.line.frame, atEnd ? run.to : run.from);
const samePlace = (p, q, width) => Math.hypot(p.x - q.x, p.y - q.y) <= width + SAME * 4;

/**
 * How each moved stretch (a run) reconnects at its ends, and each end's partner: the end of the
 * run across the moved wall at the same place.
 */
export function prepareEnds(derived, runs) {
  for (const run of runs)
    run.ends = [false, true].map((atEnd) => ({
      atEnd,
      line: run.line,
      point: endPoint(run, atEnd),
      situation: endSituation(
        derived.lines,
        derived.caps,
        run.line,
        atEnd ? run.to : run.from,
        atEnd
      ),
    }));
  for (const run of runs)
    for (const end of run.ends)
      end.partner =
        run.partnerRun?.ends?.find((other) => samePlace(other.point, end.point, run.width)) || null;
}

/**
 * Move each run (by `delta`, or by its own `map`), reconnect its ends, carry anchors and openings,
 * and anchor the edges the edit created. `seatJog` may place a jog again (R1).
 */
export function editRuns(primary, derived, runs, delta, { createId, specifications, seatJog }) {
  const additions = [];
  for (const run of runs) {
    const room = primary.rooms.find((entry) => entry.id === run.roomId);
    const previous = new Map();
    for (const anchor of primary.anchors)
      if (anchor.roomId === room.id && !previous.has(anchor.edgeId))
        previous.set(anchor.edgeId, anchor);
    const ends = [false, true].map((atEnd) => {
      const plan = planEnd(derived, run, atEnd, delta);
      return seatJog ? seatJog(run, plan, atEnd) : plan;
    });
    const edited = moveRoomStretch(
      room,
      {
        line: run.line,
        from: run.from,
        to: run.to,
        delta,
        map: run.map,
        unmap: run.unmap,
        ends,
        preferMoved: run.preferMoved,
      },
      createId
    );
    remapRoomSpans(primary, room, edited.edges, edited.lengths, createId);
    for (const [edgeId, entry] of edited.edges) {
      const anchor =
        (entry.jog && !entry.replaces && ends[entry.end]?.jogAnchor) ||
        (entry.extension && ends[entry.extension === 'end' ? 1 : 0].joinAnchor);
      // What a created stretch is when it ends up neither a cap nor part of a contact.
      const fallback = entry.jog
        ? ends[entry.end]?.jogAnchor || null
        : entry.extension
          ? previous.get(entry.edgeId) || null
          : null;
      if (anchor || entry.jog || fallback)
        additions.push({ room, edgeId, anchor, jog: entry.jog, fallback });
    }
  }
  anchorNewEdges(primary, additions, specifications, createId);
}

/**
 * Anchor the edges the edit created. F2: a jog lying against another room's existing wall has no
 * wall of its own there, whether the edit created it or placed it again (that wall continues over
 * the contact, and what is left of the jog in its corner is a cap); otherwise F1, a new jog copies
 * the part chosen for it, and a placed jog keeps its own wall.
 */
function anchorNewEdges(primary, additions, specifications, createId) {
  if (!additions.length) return;
  const after = deriveBuildingPlanPieces(primary, specifications);
  const lineOf = (roomId, index) =>
    after.lines.find((entry) => entry.roomId === roomId && entry.index === index);
  const meetsExistingWall = ({ room, edgeId }) => {
    const line = after.lines.find(
      (entry) => entry.roomId === room.id && entry.edges.some((edge) => edge.id === edgeId)
    );
    const edge = line.edges.find((entry) => entry.id === edgeId);
    return after.pieces.some((piece) => {
      const own = piece.lines.find(
        (entry) =>
          entry.roomId === room.id &&
          entry.index === line.index &&
          Math.min(entry.to, edge.to) - Math.max(entry.from, edge.from) > SAME
      );
      const other = own && piece.lines.find((entry) => entry !== own);
      return other && anchorAt(lineOf(other.roomId, other.index), other.from, other.to);
    });
  };
  for (const addition of additions) {
    if (addition.jog && meetsExistingWall(addition)) {
      primary.anchors = primary.anchors.filter(
        (anchor) => !(anchor.roomId === addition.room.id && anchor.edgeId === addition.edgeId)
      );
      continue;
    }
    if (!addition.anchor) continue;
    primary.anchors.push({
      subjectId: addition.anchor.subjectId,
      faceId: createId(),
      roomId: addition.room.id,
      edgeId: addition.edgeId,
      from: 0,
      to: null,
      bindingId: null,
      lineage: { jogOriginFaceId: addition.anchor.faceId },
    });
  }
  settleBareStretches(primary, additions, specifications, createId);
}

/**
 * A stretch the edit created that is neither a cap nor part of a contact is a wall of its own: it
 * takes the identity it came from (a jog its F1 copy, an extension the wall it was part of).
 */
function settleBareStretches(primary, additions, specifications, createId) {
  const pending = additions.filter((addition) => addition.fallback);
  if (!pending.length) return;
  const settled = deriveBuildingPlanPieces(primary, specifications);
  for (const { room, edgeId, fallback } of pending) {
    const line = settled.lines.find(
      (entry) => entry.roomId === room.id && entry.edges.some((edge) => edge.id === edgeId)
    );
    const edge = line?.edges.find((entry) => entry.id === edgeId);
    if (!edge) continue;
    for (const piece of settled.pieces) {
      if (piece.subjectId != null || piece.partition) continue;
      for (const entry of piece.lines) {
        if (entry.roomId !== room.id || entry.index !== line.index) continue;
        const from = Math.max(entry.from, edge.from);
        const to = Math.min(entry.to, edge.to);
        if (to - from <= SAME) continue;
        primary.anchors.push({
          subjectId: fallback.subjectId,
          faceId: createId(),
          roomId: room.id,
          edgeId,
          from: from - edge.from,
          to: to - edge.from,
          bindingId: null,
          lineage: { jogOriginFaceId: fallback.faceId },
        });
      }
    }
  }
}
