import { SAME, along, lineFrame, offset } from './grid.js';

/** Signed area; positive for counter-clockwise vertices. */
export function signedArea(vertices) {
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    area += a.x * b.y - a.y * b.x;
  }
  return area / 2;
}

/**
 * Maximal straight runs of a room boundary. Collinear vertices (automatic stations, cuts)
 * stay as stations along the run, so contacts are found per supporting line.
 *
 * `outward` is the sign of the frame offset of a point outside the room: a point at distance d
 * beyond the run has `offset(frame, point) === outward * d`.
 *
 * @returns {Array<{roomId: string, frame: Object, outward: number,
 *   edges: Array<{id: string, from: number, to: number}>,
 *   cuts: Array<{station: number, cutId: string}>}>}
 */
export function roomLines(room) {
  const vertices = room.vertices;
  const count = vertices.length;
  if (count < 3) return [];
  const outward = signedArea(vertices) > 0 ? -1 : 1;
  const edgeId = (i) =>
    room.edges?.find(
      (edge) => edge.startId === vertices[i].id && edge.endId === vertices[(i + 1) % count].id
    )?.id ?? null;
  const continues = (i) => {
    // Vertex i is interior to a run when its two edges lie on one line, pointing the same way.
    const previous = vertices[(i + count - 1) % count];
    const next = vertices[(i + 1) % count];
    const frame = lineFrame(previous, next);
    if (!frame) return false;
    const station = along(frame, vertices[i]);
    return (
      Math.abs(offset(frame, vertices[i])) <= SAME &&
      station > SAME &&
      station < frame.length - SAME
    );
  };
  const start = [...Array(count).keys()].find((i) => !continues(i));
  if (start == null) return [];
  const lines = [];
  for (let k = 0; k < count; ) {
    const first = (start + k) % count;
    const indices = [first];
    let j = k + 1;
    while (j < count && continues((start + j) % count)) indices.push((start + j++) % count);
    const last = (start + j) % count;
    const frame = lineFrame(vertices[first], vertices[last]);
    k = j;
    if (!frame) continue;
    const edges = indices.map((index) => ({
      id: edgeId(index),
      from: along(frame, vertices[index]),
      to: along(frame, vertices[(index + 1) % count]),
    }));
    const cuts = [first, ...indices.slice(1), last]
      .map((index) => vertices[index])
      .filter((vertex) => vertex.editingCutId)
      .map((vertex) => ({ station: along(frame, vertex), cutId: vertex.editingCutId }));
    lines.push({ roomId: room.id, frame, outward, edges, cuts });
  }
  return lines;
}
