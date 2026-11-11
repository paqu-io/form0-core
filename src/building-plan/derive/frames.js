import { lineFrame } from './grid.js';
import { signedArea } from './room-lines.js';

/** Sign of the frame offset of a point outside a room's edges (see `roomLines`). */
export const outwardSign = (room) => (signedArea(room.vertices) > 0 ? -1 : 1);

/** Endpoints of a room edge, in the room's vertex order. */
export function edgeEnds(room, edgeId) {
  const edge = room.edges.find((entry) => entry.id === edgeId);
  if (!edge) return null;
  const vertex = (id) => room.vertices.find((point) => point.id === id);
  const ends = [vertex(edge.startId), vertex(edge.endId)];
  return ends.every(Boolean) ? ends : null;
}

/**
 * The row a wall's orientation is read from: its edge endpoints and its body sign. A wall runs
 * along `bodySign` times the edge direction, so that the row lies on side +1: for a room row the
 * room is on side +1 (`bodySign` is minus the room's outward sign); for a partition row the
 * drawn face is on side +1 and the wall body on side -1.
 *
 * @returns {{ends: [Object, Object], bodySign: 1|-1}|null}
 */
export function rowFrame(rooms, row) {
  if (row.partition) {
    const index = row.partition.freeEdges.indexOf(row.edgeId);
    const ends = [row.partition.path[index], row.partition.path[index + 1]];
    const side = row.partition.sides[index];
    return ends.every(Boolean) && side ? { ends, bodySign: side } : null;
  }
  const room = rooms.get(row.roomId);
  const ends = room && edgeEnds(room, row.edgeId);
  return ends ? { ends, bodySign: -outwardSign(room) } : null;
}

/** Canonical unit direction of a wall seen from one of its rows. */
export function rowTangent(rooms, row) {
  const frame = rowFrame(rooms, row);
  const line = frame && lineFrame(...frame.ends);
  return line && { x: line.tangent.x * frame.bodySign, y: line.tangent.y * frame.bodySign };
}
