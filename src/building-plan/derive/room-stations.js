import { SAME } from './grid.js';

const onLine = (entry, roomId, index) => entry.roomId === roomId && entry.index === index;

/** The piece whose span on a room line covers [from, to]. */
export function coveringPiece(context, roomId, index, from, to) {
  return context.pieces.find((piece) =>
    piece.lines.some(
      (entry) => onLine(entry, roomId, index) && entry.from - SAME <= from && to <= entry.to + SAME
    )
  );
}

/**
 * Piece ends on a room line. A facing line runs opposite to a piece's first line, so its `from`
 * is the piece's far end; the physical end names the boundary on both rooms.
 */
function pieceEnds(context, roomId, index) {
  const ends = [];
  for (const [uid, piece] of context.pieces.entries())
    piece.lines.forEach((entry, position) => {
      if (!onLine(entry, roomId, index)) return;
      const shared = piece.lines.length > 1;
      ends.push({ station: entry.from, key: `${uid}:${position ? 'end' : 'start'}`, shared });
      ends.push({ station: entry.to, key: `${uid}:${position ? 'start' : 'end'}`, shared });
    });
  return ends;
}

/**
 * Every piece end on a room line must be a vertex. A missing one is inserted with a new
 * `physicalBoundaryId` (shared by both rooms at that boundary); a collinear vertex that is not an
 * explicit cut and lies inside one piece is removed, joining its edges. Corners and cuts stay.
 *
 * Edge identity: an output edge keeps the ID of a source edge whose row is its subject's
 * reference row, else whose row has its subject, else the first; other edges get new IDs.
 *
 * @returns {{room: Object, outputs: Array<Object>}} The room (vertices, edges) and, per output
 *   edge, its line, stations, source edges and piece.
 */
export function placeRoomStations(context, room, markers) {
  const count = room.vertices.length;
  const edgeAt = (i) =>
    room.edges.find(
      (edge) =>
        edge.startId === room.vertices[i].id && edge.endId === room.vertices[(i + 1) % count].id
    );
  const locate = (edge) => edge && context.edgeLine.get(`${room.id}:${edge.id}`);
  const removed = new Set();
  for (let i = 0; i < count; i++) {
    const vertex = room.vertices[i];
    const [before, after] = [edgeAt((i + count - 1) % count), edgeAt(i)].map(locate);
    if (vertex.editingCutId || !before || !after || before.line !== after.line) continue;
    const station = after.edge.from;
    const inside = context.pieces.some((piece) =>
      piece.lines.some(
        (entry) =>
          onLine(entry, room.id, after.line.index) &&
          entry.from < station - SAME &&
          entry.to > station + SAME
      )
    );
    if (inside) removed.add(vertex.id);
  }
  const start = room.vertices.findIndex((vertex) => !removed.has(vertex.id));
  if (start < 0) return { room, outputs: [] };

  const vertices = [];
  const outputs = [];
  let current = null;
  const close = (endId) => {
    const sources = current.sources;
    outputs.push({ ...current, endId, from: sources[0].from, to: sources.at(-1).to });
  };
  for (let k = 0; k < count; k++) {
    const i = (start + k) % count;
    const vertex = room.vertices[i];
    const edge = edgeAt(i);
    const located = locate(edge);
    if (!removed.has(vertex.id)) {
      if (current) close(vertex.id);
      vertices.push(vertex);
      current = { startId: vertex.id, line: located?.line ?? null, sources: [] };
    }
    const [from, to] = located ? [located.edge.from, located.edge.to] : [0, 0];
    const stations = located
      ? pieceEnds(context, room.id, located.line.index)
          .filter((end) => end.station > from + SAME && end.station < to - SAME)
          .sort((a, b) => a.station - b.station || Number(b.shared) - Number(a.shared))
          .filter((end, index, list) => !index || end.station - list[index - 1].station > SAME)
      : [];
    let cursor = from;
    for (const end of stations) {
      current.sources.push({ edgeId: edge.id, from: cursor, to: end.station });
      const [a, b] = [vertex, room.vertices[(i + 1) % count]];
      const t = (end.station - from) / (to - from);
      if (!markers.has(end.key)) markers.set(end.key, context.createId());
      const inserted = {
        id: context.createId(),
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        physicalBoundaryId: markers.get(end.key),
      };
      vertices.push(inserted);
      close(inserted.id);
      current = { startId: inserted.id, line: located.line, sources: [] };
      cursor = end.station;
    }
    current.sources.push({ edgeId: edge?.id ?? null, from: cursor, to });
  }
  close(vertices[0].id);

  for (const output of outputs)
    output.piece = output.line
      ? coveringPiece(context, room.id, output.line.index, output.from, output.to)
      : null;
  assignEdgeIds(context, room, outputs);
  return {
    room: {
      ...room,
      vertices,
      edges: outputs.map((output) => ({
        id: output.id,
        startId: output.startId,
        endId: output.endId,
      })),
    },
    outputs,
  };
}

function assignEdgeIds(context, room, outputs) {
  const pairs = [];
  outputs.forEach((output, position) => {
    const subject = output.piece && context.subjects.get(output.piece.subjectId);
    output.sources.forEach((source) => {
      if (!source.edgeId) return;
      const anchor = context.anchorByEdge.get(`${room.id}:${source.edgeId}`);
      const reference = Boolean(subject && anchor && anchor.faceId === subject.referenceFaceId);
      const same = Boolean(subject && anchor && context.resolve(anchor.subjectId) === subject.id);
      pairs.push({ output, position, edgeId: source.edgeId, rank: 2 * reference + same });
    });
  });
  pairs.sort((a, b) => b.rank - a.rank || a.position - b.position);
  const used = new Set();
  for (const pair of pairs) {
    if (pair.output.id || used.has(pair.edgeId)) continue;
    pair.output.id = pair.edgeId;
    used.add(pair.edgeId);
  }
  for (const output of outputs) {
    output.id ||= context.createId();
    output.split = output.sources.some(
      (source) =>
        outputs.filter((other) => other.sources.some((s) => s.edgeId === source.edgeId)).length > 1
    );
  }
}
