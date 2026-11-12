import { GAP_TOLERANCE, SAME, along, offset } from './grid.js';
import { deriveBuildingPlanPieces } from './pieces.js';
import { contactWindow, facingGap } from './contact-window.js';
import { otherLines } from './face-contacts.js';
import { inward, subjectNear } from './face-plans.js';
import { editRuns } from './run-edits.js';

const dot = (a, b) => a.x * b.x + a.y * b.y;

/** Where the same supporting line of the room ran before the edit (stations of `line`). */
function coverageBefore(before, roomId, line) {
  return before.lines
    .filter(
      (old) =>
        old.roomId === roomId &&
        dot(old.frame.tangent, line.frame.tangent) > 0 &&
        Math.abs(offset(line.frame, old.frame.start)) <= SAME &&
        Math.abs(offset(line.frame, old.frame.end)) <= SAME
    )
    .map((old) =>
      [along(line.frame, old.frame.start), along(line.frame, old.frame.end)].sort((x, y) => x - y)
    );
}

/** The parts of `[from, to]` outside every interval of `covered`. */
function outside([from, to], covered) {
  let parts = [[from, to]];
  for (const [a, b] of covered)
    parts = parts.flatMap(([p, q]) =>
      [
        [p, Math.min(q, a)],
        [Math.max(p, b), q],
      ].filter(([x, y]) => y - x > SAME)
    );
  return parts;
}

/**
 * A stretch the edit added to an existing line of an edited room (a slid corner's adjoining line
 * runs on past its old end) that would stand inside another room's wall: closer to that room's
 * face than the wall's current width, and at no width the contact may have.
 */
function findSeat(primary, before, derived, roomIds, context) {
  const { floor, specifications, keep } = context;
  for (const roomId of roomIds) {
    const others = otherLines(primary, [roomId]);
    for (const line of derived.lines.filter((entry) => entry.roomId === roomId)) {
      const covered = coverageBefore(before, roomId, line);
      if (!covered.length) continue;
      for (const b of others) {
        const found = facingGap(line, b);
        if (!found || found.gap <= SAME) continue;
        const window = contactWindow(primary, floor, specifications, roomId, b, found.onB, keep);
        if (!(window.seat > 0) || !(window.existing > 0)) continue;
        // At a width the contact may have (inherited or current), it is a contact already.
        if (found.gap >= window.existing - SAME) continue;
        if (window.widths.some((width) => Math.abs(found.gap - width) <= GAP_TOLERANCE)) continue;
        const [part] = outside(found.onA, covered);
        if (part) return { roomId, line, part, distance: found.gap - window.seat };
      }
    }
  }
  return null;
}

/**
 * Rule M6 (B): a stretch an edit lengthened that would stand inside another room's wall lands at
 * the contact's width instead; the wall in place holds (R1). The stretch moves towards (or away
 * from) that wall; it slides along the line it meets at a corner, and a jog joins it to the part
 * of its line that stays where the neighbour's wall begins.
 *
 * @param {Object} primary Primary data after the edit (edited in place).
 * @param {Object} before The derivation before the edit.
 * @param {string[]} roomIds The rooms the edit changed.
 * @param {Object} context R1's context (`floor`, `specifications`, `keep`).
 * @param {() => string} createId
 */
export function seatLengthenedStretches(primary, before, roomIds, context, createId) {
  const { specifications } = context;
  for (let pass = 0; pass < 8; pass++) {
    const derived = deriveBuildingPlanPieces(primary, specifications);
    const seat = findSeat(primary, before, derived, roomIds, context);
    if (!seat) return;
    const { line, part, distance } = seat;
    const end = (station, towards) =>
      station <= SAME || station >= line.frame.length - SAME
        ? { type: 'slide' }
        : { type: 'jog', station, jogAnchor: subjectNear(line, station, towards) };
    const out = { x: -inward(line).x * distance, y: -inward(line).y * distance };
    // The part that stays keeps its edges and rows (what did not change keeps its identity).
    const run = {
      roomId: seat.roomId,
      line,
      from: part[0],
      to: part[1],
      delta: out,
      preferStaying: true,
      ownEnds: [end(part[0], part[1]), end(part[1], part[0])],
    };
    editRuns(primary, derived, [run], out, { createId, specifications });
    dropSeatedAnchors(primary, seat, out);
  }
}

/**
 * F2 for a seated stretch: it lies against the other room's existing wall, which continues over
 * the contact; the stretch has no wall of its own there.
 */
function dropSeatedAnchors(primary, { roomId, line, part }, out) {
  const room = primary.rooms.find((entry) => entry.id === roomId);
  const vertex = (id) => room.vertices.find((entry) => entry.id === id);
  const seated = (point) => {
    const back = { x: point.x - out.x, y: point.y - out.y };
    const station = along(line.frame, back);
    return (
      Math.abs(offset(line.frame, back)) <= SAME &&
      station >= part[0] - SAME &&
      station <= part[1] + SAME
    );
  };
  const edges = new Set(
    room.edges
      .filter((edge) => seated(vertex(edge.startId)) && seated(vertex(edge.endId)))
      .map((edge) => edge.id)
  );
  primary.anchors = primary.anchors.filter(
    (anchor) => !(anchor.roomId === roomId && edges.has(anchor.edgeId))
  );
}
