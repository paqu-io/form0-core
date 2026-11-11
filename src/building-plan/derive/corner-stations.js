import { cleanPoint } from '../geometry.js';
import { SAME, along, lineFrame, offset } from './grid.js';
import { deriveBuildingPlanPieces } from './pieces.js';

const refuse = (code, message) => {
  throw Object.assign(new Error(message), { issues: [{ code, message }] });
};
const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const lengthOf = (room, edge) => {
  const [p, q] = [edge.startId, edge.endId].map((id) => room.vertices.find((v) => v.id === id));
  return gap(p, q);
};

/**
 * Remove an automatic station from a room outline: the edge `dropEdgeId` (one of the station's
 * two edges) goes with its rows, and the other edge reaches the vertex beyond. Refuses when a
 * row on the dropped edge hosts an opening.
 */
export function removeStation(primary, room, vertexId, dropEdgeId) {
  const into = room.edges.find((edge) => edge.endId === vertexId);
  const out = room.edges.find((edge) => edge.startId === vertexId);
  const kept = dropEdgeId === into.id ? out : into;
  const dropped = primary.anchors.filter(
    (anchor) => anchor.roomId === room.id && anchor.edgeId === dropEdgeId
  );
  const hosts = new Set(
    [...primary.subjects.values()].flatMap((subject) =>
      (subject.openings || []).map((opening) => opening.faceId)
    )
  );
  if (dropped.some((anchor) => hosts.has(anchor.faceId)))
    refuse(
      'opening_crosses_edit_boundary',
      'An opening crosses this wall edit. Move it or split a different portion.'
    );
  primary.anchors = primary.anchors.filter((anchor) => !dropped.includes(anchor));
  room.vertices = room.vertices.filter((vertex) => vertex.id !== vertexId);
  room.edges = room.edges
    .filter((edge) => edge.id !== dropEdgeId)
    .map((edge) =>
      edge !== kept
        ? edge
        : kept === out
          ? { ...edge, startId: into.startId }
          : { ...edge, endId: out.endId }
    );
}

/**
 * Stations of a run whose line keeps its place (the corner moves along it) stay where they are;
 * the ones the corner reached or passed leave the outline with the edge towards the corner.
 */
export function dropPassedStations(primary, room, side, point) {
  const after = lineFrame(side.fixed, point);
  for (const id of side.ids.slice(1, -1)) {
    const vertex = room.vertices.find((v) => v.id === id);
    if (!vertex || along(after, vertex) < after.length - SAME) continue;
    const towards = room.edges.find(
      (edge) =>
        (edge.startId === id && edge.endId === side.corner.id) ||
        (edge.endId === id && edge.startId === side.corner.id)
    );
    if (!vertex.physicalBoundaryId || vertex.editingCutId || !towards)
      refuse('invalid_room_geometry', 'This corner would pass a cut of its wall.');
    removeStation(primary, room, id, towards.id);
  }
}

/**
 * Shared extents transform together: an automatic station of the corner's runs that bounded a
 * shared wall moves along its line to where that wall now ends (the neighbour's corner seen from
 * this room), and the rows on either side follow it. A station that lands on the vertex beside it
 * merges into it.
 */
export function snapStations(primary, room, sides, specifications) {
  const inner = new Set(sides.flatMap((side) => side.ids.slice(1, -1)));
  const stations = room.vertices.filter(
    (v) => inner.has(v.id) && v.physicalBoundaryId && !v.editingCutId
  );
  if (!stations.length) return;
  const derived = deriveBuildingPlanPieces(primary, specifications);
  for (const vertex of stations) {
    const line = derived.lines.find(
      (entry) =>
        entry.roomId === room.id &&
        Math.abs(offset(entry.frame, vertex)) <= SAME &&
        along(entry.frame, vertex) > SAME &&
        along(entry.frame, vertex) < entry.frame.length - SAME
    );
    if (!line) continue;
    const here = along(line.frame, vertex);
    let best = null;
    for (const piece of derived.pieces) {
      if (piece.lines.length < 2) continue;
      for (const entry of piece.lines)
        if (entry.roomId === room.id && entry.index === line.index)
          for (const end of [entry.from, entry.to]) {
            const distance = Math.abs(end - here);
            if (distance > SAME && distance <= piece.width && (!best || distance < best.distance))
              best = { end, distance };
          }
    }
    if (!best) continue;
    const point = {
      x: line.frame.start.x + line.frame.tangent.x * best.end,
      y: line.frame.start.y + line.frame.tangent.y * best.end,
    };
    const before = room.edges.find((edge) => edge.endId === vertex.id);
    const after = room.edges.find((edge) => edge.startId === vertex.id);
    const shift = best.end - here;
    for (const anchor of primary.anchors) {
      if (anchor.roomId !== room.id || anchor.to == null) continue;
      if (anchor.edgeId === before?.id && anchor.to >= lengthOf(room, before) - SAME)
        anchor.to += shift;
      if (anchor.edgeId === after?.id) {
        if (anchor.from > SAME) anchor.from -= shift;
        anchor.to -= shift;
      }
    }
    room.vertices = room.vertices.map((v) => (v === vertex ? { ...v, ...cleanPoint(point) } : v));
    const [previous, next] = [before.startId, after.endId].map((id) =>
      room.vertices.find((v) => v.id === id)
    );
    if (gap(point, previous) <= SAME) removeStation(primary, room, vertex.id, before.id);
    else if (gap(point, next) <= SAME) removeStation(primary, room, vertex.id, after.id);
  }
}
