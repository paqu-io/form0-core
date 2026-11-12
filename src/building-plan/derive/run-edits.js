import { SAME, along, offset, pointAt } from './grid.js';
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
  const key = (line) => `${line.roomId}:${line.index}`;
  const moving = new Set(runs.filter((run) => !run.stationary).map((run) => key(run.line)));
  for (const run of runs)
    run.ends = [false, true].map((atEnd) => ({
      atEnd,
      stationary: Boolean(run.stationary),
      line: run.line,
      point: endPoint(run, atEnd),
      situation: holdContactJog(
        derived,
        moving,
        endSituation(derived.lines, derived.caps, run.line, atEnd ? run.to : run.from, atEnd)
      ),
    }));
  for (const run of runs)
    for (const end of run.ends) {
      // A stretch made of two sides' stretches takes each end's partner from its own side.
      const partnerRun = run.partnerRuns?.[end.atEnd ? 1 : 0] || run.partnerRun;
      end.partner =
        partnerRun?.ends?.find((other) => samePlace(other.point, end.point, run.width)) || null;
    }
}

/**
 * A step's jog that is (partly) a contact with another room's line this edit does not move is
 * that room's wall too (`held`): while the step remains, it holds and the moved stretch's corner
 * slides along it instead of placing the jog again (R1; see `planEnd`).
 */
function holdContactJog(derived, moving, situation) {
  if (situation.kind !== 'shift') return situation;
  const { jog } = situation;
  const contact = derived.pieces.some(
    (piece) =>
      piece.lines.some((entry) => entry.roomId === jog.roomId && entry.index === jog.index) &&
      piece.lines.some(
        (entry) =>
          entry.roomId &&
          entry.roomId !== jog.roomId &&
          !moving.has(`${entry.roomId}:${entry.index}`)
      )
  );
  return contact ? { ...situation, held: true } : situation;
}

/**
 * Move each run (by its own `delta` or `map`, else by `delta`), reconnect its ends (as planned,
 * or as its `ownEnds` say), carry anchors and openings, and anchor the edges the edit created.
 * `seatJog` may place a jog again (R1).
 */
export function editRuns(primary, derived, runs, delta, { createId, specifications, seatJog }) {
  const additions = [];
  const done = new Set();
  for (let run of runs) {
    const room = primary.rooms.find((entry) => entry.id === run.roomId);
    // A second stretch of a room already edited: find its line again in the current geometry.
    // (A wrapped corner's second stretch keeps its line: the first placed the corner already.)
    if (done.has(room.id) && !run.readBack) {
      run = refreshRun(primary, run, specifications);
      if (!run) continue;
    }
    done.add(room.id);
    const previous = new Map();
    for (const anchor of primary.anchors)
      if (anchor.roomId === room.id && !previous.has(anchor.edgeId))
        previous.set(anchor.edgeId, anchor);
    const ends =
      run.fixedEnds ||
      [false, true].map((atEnd) => {
        if (run.ownEnds?.[atEnd ? 1 : 0]) return run.ownEnds[atEnd ? 1 : 0];
        const plan = planEnd(derived, run, atEnd, run.delta || delta, primary);
        return seatJog ? seatJog(run, plan, atEnd) : plan;
      });
    const edited = moveRoomStretch(
      room,
      {
        line: run.line,
        from: run.from,
        to: run.to,
        delta: run.fixedEnds ? { x: 0, y: 0 } : run.delta || delta,
        map: run.map,
        unmap: run.unmap,
        ends,
        preferMoved: run.preferMoved,
        bendAt: run.bendAt,
        readBack: run.readBack,
        // Decision F: only a corner drag (a turned stretch) may reverse a return.
        reverse: Boolean(run.map),
      },
      createId
    );
    remapRoomSpans(primary, room, edited.edges, edited.lengths, createId);
    for (const [edgeId, entry] of edited.edges) {
      const anchor =
        (entry.jog && !entry.replaces && !entry.reversed && ends[entry.end]?.jogAnchor) ||
        (entry.extension && ends[entry.extension === 'end' ? 1 : 0].joinAnchor);
      // What a created stretch is when it ends up neither a cap nor part of a contact.
      // A reversed return keeps the row of the old edge it came from (built rule 7).
      const fallback = entry.jog
        ? (entry.reversed ? previous.get(entry.reversed) : ends[entry.end]?.jogAnchor) || null
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

/**
 * A stretch planned on the geometry before an earlier stretch of the same room moved: its line in
 * the current geometry (collinear, same direction, overlapping), its stretch there, and its ends
 * planned again from a fresh derivation. Null when the stretch is gone.
 */
function refreshRun(primary, run, specifications) {
  const fresh = deriveBuildingPlanPieces(primary, specifications);
  const [p, q] = [run.from, run.to].map((station) => pointAt(run.line.frame, station));
  const line = fresh.lines.find(
    (entry) =>
      entry.roomId === run.roomId &&
      entry.frame.tangent.x * run.line.frame.tangent.x +
        entry.frame.tangent.y * run.line.frame.tangent.y >
        0 &&
      [p, q].every((point) => Math.abs(offset(entry.frame, point)) <= SAME)
  );
  if (!line) return null;
  // An end planned at the line's end (a wrapped corner) still reaches it.
  let from = run.ownEnds?.[0] ? 0 : Math.max(0, along(line.frame, p));
  let to = run.ownEnds?.[1] ? line.frame.length : Math.min(line.frame.length, along(line.frame, q));
  // The first stretch's corner passed this stretch's far end: the whole remaining line follows.
  if (run.ownEnds?.[0] && to <= from + SAME) to = line.frame.length;
  if (run.ownEnds?.[1] && to <= from + SAME) from = 0;
  if (to - from <= SAME) return null;
  const next = { ...run, line, from, to };
  const partner = run.ends.map((end) => end.partner);
  prepareEnds(fresh, [next]);
  next.ends.forEach((end, index) => (end.partner = partner[index]));
  return next;
}
