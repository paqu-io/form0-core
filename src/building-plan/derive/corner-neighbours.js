import { SAME, along, lineFrame, offset, pointAt } from './grid.js';

/** Intersection of the lines through a and b and through c and d, or null if parallel. */
function crossing(a, b, c, d) {
  const [u, v] = [
    { x: b.x - a.x, y: b.y - a.y },
    { x: d.x - c.x, y: d.y - c.y },
  ];
  const det = u.x * v.y - u.y * v.x;
  if (Math.abs(det) <= 1e-12) return null;
  const t = ((c.x - a.x) * v.y - (c.y - a.y) * v.x) / det;
  return { x: a.x + u.x * t, y: a.y + u.y * t };
}

/**
 * A dragged Split point's counterpart (rule 6 of item 4): both stretches lie on one line of the
 * neighbour and meet at its cut with the same ID. Returns that station, or null.
 */
function counterpartCut(first, second) {
  const cutId = first.side.corner.editingCutId;
  if (!cutId || first.line !== second.line || Math.abs(first.to - second.from) > SAME) return null;
  const meet = first.to;
  return first.line.cuts.some((cut) => cut.cutId === cutId && Math.abs(cut.station - meet) <= SAME)
    ? meet
    : null;
}

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
 * remainders between follow the line) and it slides to where the moved lines meet. For a dragged
 * Split point the counterpart is the neighbour's cut with the same ID on one straight line.
 */
function wrapCorners(derived, runs) {
  const following = runs.filter((run) => !run.stationary);
  const merges = [];
  for (const first of following)
    for (const second of following) {
      if (first.roomId !== second.roomId || first.side === second.side) continue;
      const meet = counterpartCut(first, second);
      if (meet != null) {
        // One stretch that becomes two lines at the cut: the cut goes where they meet.
        const { start, end } = first.line.frame;
        const point = crossing(
          first.map(start),
          first.map(end),
          second.map(start),
          second.map(end)
        );
        if (point) merges.push({ first, second, meet, point });
        continue;
      }
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
      // The counterpart corner: where both moved lines meet.
      const corner = first.line.frame.end;
      const movedFirst = lineFrame(first.map(first.line.frame.start), first.map(corner));
      const [p, q] = [second.map(corner), second.map(second.line.frame.end)];
      const aligned = [p, q].every((point) => Math.abs(offset(movedFirst, point)) <= SAME);
      // On one straight line again, the counterpart lies across from the dragged vertex.
      const dragged = first.map(first.side.corner);
      const across = pointAt(movedFirst, along(movedFirst, dragged));
      const point = (!aligned && crossing(movedFirst.start, movedFirst.end, p, q)) || across;
      first.to = end;
      second.from = 0;
      // The first stretch puts the corner in place; the second line has not moved yet, so its
      // edge there reads back from the old corner. The second keeps its line and reads back
      // against its frames from before the first.
      // When the second line keeps its place the corner simply slides along it (passing its
      // stations, or reversing a return); otherwise it goes straight to where it belongs.
      const placed = second.side.keepsLine
        ? { type: 'slide' }
        : { type: 'slide', point, out: corner };
      first.ownEnds = [first.ownEnds?.[0] ?? null, placed];
      second.ownEnds = [{ type: 'slide', point }, second.ownEnds?.[1] ?? null];
      const frame = second.line.frame;
      second.readBack = new Map(
        second.line.edges.map((e) => [
          e.id,
          lineFrame(pointAt(frame, e.from), pointAt(frame, e.to)),
        ])
      );
    }
  for (const { first, second, meet, point } of merges) {
    runs.splice(runs.indexOf(second), 1);
    Object.assign(first, {
      to: second.to,
      maps: [first.map, second.map],
      bendAt: { station: meet, point, map: second.map, unmap: second.unmap },
      partnerRuns: [first.partnerRun, second.partnerRun],
      ownEnds: [first.ownEnds?.[0] ?? null, second.ownEnds?.[1] ?? null],
    });
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
