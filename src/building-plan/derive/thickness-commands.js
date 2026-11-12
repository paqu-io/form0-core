import { SAME } from './grid.js';
import { deriveBuildingPlanPieces } from './pieces.js';
import { resolutionFloor, resolveWallThickness } from './thickness.js';
import { seatJogStation } from './face-contacts.js';
import { inward } from './face-plans.js';
import { editRuns, prepareEnds } from './run-edits.js';
import { junctionFollowers } from './junction-follow.js';
import { snapStations } from './corner-stations.js';
import { shiftPartitions } from './partition-thickness.js';

const refuse = (code, message) => {
  throw Object.assign(new Error(message), { issues: [{ code, message }] });
};
const sameStep = (p, q) => Math.abs(p.x - q.x) <= 1e-9 && Math.abs(p.y - q.y) <= 1e-9;

/**
 * Rule 7's anchor: the active room (per wall in a batch), else the reference row's room, else the
 * lowest room ID.
 */
function anchorRoom(primary, piece, subject, operation) {
  const ids = piece.lines.map((entry) => entry.roomId);
  const active = operation.activeRoomsByWall?.[piece.subjectId] ?? operation.activeRoomId;
  if (ids.includes(active)) return active;
  const reference =
    subject && primary.anchors.find((anchor) => anchor.faceId === subject.referenceFaceId);
  if (ids.includes(reference?.roomId)) return reference.roomId;
  return [...ids].sort()[0];
}

/**
 * A piece's stretch of one room line, moving `amount` into its room (none: it stays). `width` is
 * the piece's current width (ends pair across it); `next` the width after the change.
 */
function stretch(derived, entry, width, next, amount = null) {
  const line = derived.lines.find((l) => l.roomId === entry.roomId && l.index === entry.index);
  const run = { roomId: entry.roomId, line, from: entry.from, to: entry.to, width, next };
  if (amount == null) return { ...run, stationary: true };
  const into = inward(line);
  return {
    ...run,
    delta: { x: into.x * amount, y: into.y * amount },
    // The moved part of an edge keeps the edge's ID (and so its rows).
    preferMoved: line.edges
      .filter((edge) => Math.min(edge.to, entry.to) - Math.max(edge.from, entry.from) > SAME)
      .map((edge) => edge.id),
  };
}

/**
 * The stretches each changed piece moves (rules 7 and 8): a shared piece moves the non-anchor
 * room's stretch by the change and keeps the anchor's (`room_face`), or moves both by half
 * (`midline`); an exterior piece moves only under `midline`. Partitions move separately (J5).
 */
function plannedStretches(primary, derived, operation, specifications) {
  const floor = resolutionFloor(primary);
  const midline = operation.thicknessAnchor === 'midline';
  const moving = [];
  const staying = [];
  const widened = [];
  for (const piece of derived.pieces) {
    if (piece.partition) continue;
    const subject = piece.subjectId ? primary.subjects.get(piece.subjectId) || null : null;
    const resolved = resolveWallThickness(floor, specifications, subject, piece.roomIds);
    // A conflict becomes the write-back's question; an unknown thickness keeps the last width.
    if (resolved.conflict || resolved.value == null) continue;
    if (!(resolved.value > 0))
      refuse('invalid_dimension', 'Wall thickness must be positive or explicitly unknown.');
    const change = resolved.value - piece.width;
    if (Math.abs(change) <= SAME) continue;
    const widths = [piece.width, resolved.value];
    widened.push([piece, resolved.value]);
    if (piece.lines.length === 1) {
      if (midline) moving.push(stretch(derived, piece.lines[0], ...widths, change / 2));
      continue;
    }
    if (midline) {
      const [a, b] = piece.lines.map((entry) => stretch(derived, entry, ...widths, change / 2));
      Object.assign(a, { partnerRun: b });
      Object.assign(b, { partnerRun: a });
      moving.push(a, b);
      continue;
    }
    const anchorId = anchorRoom(primary, piece, subject, operation);
    const [kept, moved] = [...piece.lines].sort(
      (x, y) => Number(y.roomId === anchorId) - Number(x.roomId === anchorId)
    );
    const stay = stretch(derived, kept, ...widths);
    const run = stretch(derived, moved, ...widths, change);
    Object.assign(run, { partnerRun: stay });
    Object.assign(stay, { partnerRun: run });
    moving.push(run);
    staying.push(stay);
  }
  // Ends are planned on the geometry before the change with every wall at its new width: a jog
  // keeps clear of a neighbouring wall as that wall will be.
  for (const [piece, width] of widened) piece.width = width;
  return { moving: mergeStretches(moving), staying };
}

/**
 * Stretches of one room line that meet and move alike move as one; each end keeps the partner of
 * its own side.
 */
function mergeStretches(runs) {
  const merged = [];
  const into = new Map();
  const sorted = [...runs].sort(
    (a, b) => a.roomId.localeCompare(b.roomId) || a.line.index - b.line.index || a.from - b.from
  );
  for (const run of sorted) {
    const last = merged.at(-1);
    if (
      last &&
      last.roomId === run.roomId &&
      last.line === run.line &&
      Math.abs(last.to - run.from) <= SAME &&
      sameStep(last.delta, run.delta)
    ) {
      last.partnerRuns = [last.partnerRuns?.[0] ?? last.partnerRun, run.partnerRun];
      last.to = run.to;
      last.preferMoved = [...new Set([...last.preferMoved, ...run.preferMoved])];
      into.set(run, last);
      continue;
    }
    const copy = { ...run };
    merged.push(copy);
    into.set(run, copy);
  }
  const current = (run) => (run ? into.get(run) || run : run);
  for (const run of [...merged, ...runs.flatMap((r) => [r.partnerRun].filter(Boolean))]) {
    run.partnerRun = current(run.partnerRun);
    if (run.partnerRuns) run.partnerRuns = run.partnerRuns.map(current);
  }
  return merged;
}

/**
 * A thickness change on the derived core (item 4b). `primary` holds the new answers, `before`
 * the same floor with the answers before the change. Each piece whose resolved thickness changes
 * moves room stretches as face drags planned on the geometry before the change (rules 7-9), in
 * one command. R2 (J1): a moved stretch's jog lands where the room's clear space stays out of the
 * other room's adjoining wall; the rooms where that places a jog past the stretch's end are
 * `carvedRoomIds` (J2, I5).
 *
 * @returns {{result: {carvedRoomIds: string[]}, preferredRoomIds: string[]}}
 */
export function changeThickness(primary, before, operation, { createId, specifications }) {
  const all = primary.rooms.map((room) => room.id);
  const derived = deriveBuildingPlanPieces(before, specifications);
  const { moving, staying } = plannedStretches(primary, derived, operation, specifications);
  // J5: under midline a partition's face moves by half the change; under room_face it holds.
  if (operation.thicknessAnchor === 'midline') shiftPartitions(primary, before, specifications);
  if (!moving.length) return { result: { carvedRoomIds: [] }, preferredRoomIds: all };
  prepareEnds(derived, [...moving, ...staying]);
  // Ends paired at the current width; jogs keep clear of the wall at its new width.
  for (const run of moving) run.width = run.next;
  const across = [...moving, ...staying].map((run) => run.partnerRun?.roomId).filter(Boolean);
  const runs = [...moving, ...junctionFollowers(derived, moving, { x: 0, y: 0 }, across)];
  const context = {
    floor: resolutionFloor(primary),
    specifications,
    tolerance: 0,
    keep: false,
    kept: [],
  };
  const carved = new Set();
  editRuns(
    primary,
    derived,
    runs,
    { x: 0, y: 0 },
    {
      createId,
      specifications,
      seatJog: (run, plan, atEnd) => {
        const seated = seatJogStation(primary, run, plan, atEnd, run.delta, context);
        // Carved: the jog lands past where the line's step was (the stretch's end, or the far
        // side of a notch an earlier change made), so the notch is new or grows.
        const { reach } = run.ends[atEnd ? 1 : 0].situation;
        if (['jog', 'shift'].includes(seated.type) && seated.station != null)
          if (Math.abs(seated.station - reach) > SAME) carved.add(run.roomId);
        return seated;
      },
    }
  );
  const edited = new Set(runs.map((run) => run.roomId));
  // Shared extents transform together: an automatic station that bounded a shared wall moves to
  // where that wall now ends.
  for (const roomId of edited) {
    const room = primary.rooms.find((entry) => entry.id === roomId);
    snapStations(
      primary,
      room,
      [{ ids: [null, ...room.vertices.map((v) => v.id), null] }],
      specifications
    );
  }
  return {
    result: { carvedRoomIds: [...carved].sort() },
    preferredRoomIds: all.filter((id) => !edited.has(id)),
  };
}
