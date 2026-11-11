import { GAP_TOLERANCE, SAME, lineFrame, offset, overlap, along, pointAt } from './grid.js';
import { roomLines } from './room-lines.js';
import { annotateLines } from './line-spans.js';
import { contactWindow, facingGap, matchedWidth } from './contact-window.js';
import { depth, inward, pieceAt } from './face-plans.js';

const refuse = (code, message) => {
  throw Object.assign(new Error(message), { issues: [{ code, message }] });
};
const dot = (a, b) => a.x * b.x + a.y * b.y;
const outwardOf = (line) => ({ x: -inward(line).x, y: -inward(line).y });

/** Current lines of every room but `roomIds`, with their anchors. */
export function otherLines(primary, roomIds) {
  return annotateLines(
    primary.rooms.filter((room) => !roomIds.includes(room.id)).flatMap(roomLines),
    primary
  );
}

/**
 * R1: a moved line that comes to face another room within a contact width (that wall's current
 * width or the width the contact would inherit) lands at the contact's width; the face already in
 * place holds. Every moved line moves by the same vector, so one distance must satisfy every new
 * contact.
 *
 * @returns {number} The distance along the dragged room's outward normal.
 */
export function seatDistance(primary, runs, distance, context) {
  const { floor, specifications, tolerance, keep, kept } = context;
  const out = outwardOf(runs[0].line);
  const lines = otherLines(
    primary,
    runs.map((run) => run.roomId)
  );
  const wanted = [];
  for (const run of runs) {
    const sign = dot(out, outwardOf(run.line));
    for (const b of lines) {
      const found = facingGap(run.line, b);
      if (!found || !overlap(found.onA, [run.from, run.to])) continue;
      const after = found.gap - sign * distance;
      if (after <= SAME) continue;
      const window = contactWindow(primary, floor, specifications, run.roomId, b, found.onB, keep);
      const near = matchedWidth(window, after, tolerance);
      if (near == null) continue;
      const seat = window.seat ?? near;
      wanted.push({
        distance: sign * (found.gap - seat),
        run,
        b,
        seat,
        inherited: window.inherited,
      });
    }
  }
  if (!wanted.length) return distance;
  if (wanted.some((entry) => Math.abs(entry.distance - wanted[0].distance) > GAP_TOLERANCE))
    refuse(
      'attachment_fit_conflict',
      'This face cannot meet all of its new neighbours at their shared wall thickness. Try a different distance.'
    );
  for (const entry of wanted)
    if (entry.seat !== entry.inherited)
      kept.push({ roomId: entry.run.roomId, line: entry.b, width: entry.seat });
  return wanted[0].distance;
}

/**
 * R1 for a jog the edit creates or places again: when it would face another room's wall within a
 * contact width, its station moves so the gap is the contact's width; the wall in place holds.
 */
export function seatJogStation(primary, run, plan, atEnd, delta, context) {
  if (!['jog', 'shift'].includes(plan.type) || plan.station == null) return plan;
  const { floor, specifications, tolerance, keep, kept } = context;
  const { line } = run;
  const end = run.ends[atEnd ? 1 : 0];
  const moved = dot(delta, inward(line));
  const base = end.situation.kind === 'shift' ? depth(line, end.situation.continuation) : 0;
  const relative = moved - base;
  if (Math.abs(relative) <= SAME) return plan;
  const foot = pointAt(line.frame, plan.station);
  const at = (value) => ({
    x: foot.x + inward(line).x * value,
    y: foot.y + inward(line).y * value,
  });
  // The jog as an edge of its room: from the moved line to the continuation at the stretch's end,
  // the other way round at its start; it shares the room's outward side.
  const frame = atEnd ? lineFrame(at(moved), at(base)) : lineFrame(at(base), at(moved));
  if (!frame) return plan;
  const jog = { roomId: run.roomId, frame, outward: line.outward };
  const jogOut = { x: frame.normal.x * line.outward, y: frame.normal.y * line.outward };
  let best = null;
  for (const b of otherLines(primary, [run.roomId])) {
    const found = facingGap(jog, b);
    if (!found || found.gap <= SAME || (best && best.gap <= found.gap)) continue;
    const window = contactWindow(primary, floor, specifications, run.roomId, b, found.onB, keep);
    const near = matchedWidth(window, found.gap, tolerance);
    if (near == null) continue;
    best = { gap: found.gap, b, seat: window.seat ?? near, inherited: window.inherited };
  }
  if (!best) return plan;
  if (best.seat !== best.inherited)
    kept.push({ roomId: run.roomId, line: best.b, width: best.seat });
  const shift = (best.gap - best.seat) * dot(jogOut, line.frame.tangent);
  return { ...plan, station: plan.station + shift };
}

/**
 * Explicit widths for contacts that must keep a width other than the inherited one: contacts
 * kept at their current width ("Keep previous values"), and F3, an existing line the edit
 * lengthened that now meets another room's wall exactly at that wall's current width.
 */
export function explicitContactWidths(primary, before, editedIds, context) {
  const { floor, specifications, kept } = context;
  const widths = [];
  const others = otherLines(primary, editedIds);
  for (const roomId of editedIds) {
    const room = primary.rooms.find((entry) => entry.id === roomId);
    for (const a of annotateLines(roomLines(room), primary))
      for (const b of others) {
        const found = facingGap(a, b);
        if (!found || found.gap <= SAME) continue;
        const key = { lines: [`${roomId}:${a.index}`, `${b.roomId}:${b.index}`], width: found.gap };
        const keep = kept.find(
          (entry) =>
            entry.roomId === roomId &&
            entry.line.roomId === b.roomId &&
            entry.line.index === b.index &&
            Math.abs(entry.width - found.gap) <= GAP_TOLERANCE
        );
        if (keep) {
          widths.push({ ...key, width: keep.width });
          continue;
        }
        const window = contactWindow(primary, floor, specifications, roomId, b, found.onB, false);
        if (Math.abs(found.gap - window.inherited) <= GAP_TOLERANCE) continue;
        const current = pieceAt(before, b, (found.onB[0] + found.onB[1]) / 2)?.width;
        if (!(current > 0) || Math.abs(found.gap - current) > GAP_TOLERANCE) continue;
        if (overlapBefore(before, room.id, a, b) >= found.onA[1] - found.onA[0] - SAME) continue;
        widths.push({ ...key, width: current });
      }
  }
  return widths;
}

/** How long the same supporting line of the room faced `b` before the edit. */
function overlapBefore(before, roomId, a, b) {
  let longest = 0;
  for (const old of before.lines) {
    if (old.roomId !== roomId || dot(old.frame.tangent, a.frame.tangent) <= 0) continue;
    if (Math.abs(offset(a.frame, old.frame.start)) > SAME) continue;
    if (Math.abs(offset(a.frame, old.frame.end)) > SAME) continue;
    const found = facingGap(old, b);
    if (found) longest = Math.max(longest, found.onA[1] - found.onA[0]);
  }
  return longest;
}

export { along };
