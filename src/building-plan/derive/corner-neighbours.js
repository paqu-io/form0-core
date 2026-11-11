import { SAME, along, offset, pointAt } from './grid.js';

/** The corner room's line holding a side's run (its first edge lies on it). */
function sideLine(derived, room, side) {
  const vertex = (id) => room.vertices.find((v) => v.id === id);
  return derived.lines.find(
    (entry) =>
      entry.roomId === room.id &&
      side.ids.slice(0, 2).every((id) => Math.abs(offset(entry.frame, vertex(id))) <= SAME) &&
      entry.edges.some((edge) => {
        const found = room.edges.find((e) => e.id === edge.id);
        return found && side.ids.includes(found.startId) && side.ids.includes(found.endId);
      })
  );
}

/** Each neighbour stretch facing a side's run, paired with the corner room's own stretch. */
function facingRuns(derived, room, side) {
  const line = sideLine(derived, room, side);
  if (!line) return [];
  const span = side.ids
    .map((id) =>
      along(
        line.frame,
        room.vertices.find((v) => v.id === id)
      )
    )
    .sort((a, b) => a - b);
  const runs = [];
  for (const piece of derived.pieces) {
    if (piece.partition || piece.lines.length < 2) continue;
    const own = piece.lines.find((e) => e.roomId === room.id && e.index === line.index);
    const other = piece.lines.find((e) => e !== own);
    if (!own || !other) continue;
    const from = Math.max(own.from, span[0]);
    const to = Math.min(own.to, span.at(-1));
    if (to - from <= SAME) continue;
    const theirs = derived.lines.find((e) => e.roomId === other.roomId && e.index === other.index);
    const [a, b] = [from, to]
      .map((s) => along(theirs.frame, pointAt(line.frame, s)))
      .sort((x, y) => x - y);
    const anchorRun = { roomId: room.id, line, from, to, width: piece.width, stationary: true };
    const run = {
      roomId: theirs.roomId,
      line: theirs,
      from: a,
      to: b,
      width: piece.width,
      map: side.map,
      unmap: side.unmap,
      partnerRun: anchorRun,
    };
    anchorRun.partnerRun = run;
    anchorRun.side = run.side = side;
    runs.push(anchorRun, run);
  }
  return runs;
}

/** No contact of the line lies strictly between two stations (only caps and remainders). */
function clearBetween(derived, line, from, to) {
  return !derived.pieces.some(
    (piece) =>
      !piece.partition &&
      piece.lines.length > 1 &&
      piece.lines.some(
        (entry) =>
          entry.roomId === line.roomId &&
          entry.index === line.index &&
          Math.min(entry.to, to) - Math.max(entry.from, from) > SAME
      )
  );
}

/**
 * A neighbour wraps the corner when it faces both runs on two consecutive lines of its own: the
 * corner between them is the dragged corner's counterpart. Both stretches reach it (caps and
 * remainders between follow the line) and it slides to where the moved lines meet.
 */
function wrapCorners(derived, runs) {
  const following = runs.filter((run) => !run.stationary);
  for (const first of following)
    for (const second of following) {
      if (first.roomId !== second.roomId || first.side === second.side) continue;
      const own = derived.lines
        .filter((line) => line.roomId === first.roomId)
        .sort((a, b) => a.index - b.index);
      if (own[(own.indexOf(first.line) + 1) % own.length] !== second.line) continue;
      const end = first.line.frame.length;
      if (
        !clearBetween(derived, first.line, first.to, end) ||
        !clearBetween(derived, second.line, 0, second.from)
      )
        continue;
      first.to = end;
      second.from = 0;
      first.ownEnds = [first.ownEnds?.[0] ?? null, { type: 'slide' }];
      second.ownEnds = [{ type: 'slide' }, second.ownEnds?.[1] ?? null];
    }
}

/**
 * Neighbours sharing a run of the dragged corner (decision F8): their facing stretch follows the
 * run's turn. A neighbour wrapping the corner moves its own corner with it. A stretch whose line
 * keeps its place (the corner moves along that run's line) is not edited: only its extent
 * changes, which the derivation follows.
 *
 * @returns {Array<Object>} Runs for `prepareEnds`/`editRuns`: each neighbour stretch with the
 *   corner room's facing stretch as its `stationary` partner.
 */
export function cornerNeighbourRuns(derived, room, sides) {
  const runs = sides.flatMap((side) => facingRuns(derived, room, side));
  wrapCorners(derived, runs);
  return runs.filter((run) => !run.side.keepsLine);
}
