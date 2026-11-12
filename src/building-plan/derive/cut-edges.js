import { cleanPoint } from '../geometry.js';
import { SAME } from './grid.js';

const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const vertexOf = (room, id) => room.vertices.find((vertex) => vertex.id === id);
export const edgeLength = (room, edge) =>
  gap(vertexOf(room, edge.startId), vertexOf(room, edge.endId));

/**
 * Insert `vertex` into a room edge, `at` metres from its start. The edge keeps its ID up to the
 * vertex; a new edge runs on from it. Rows on the edge follow their stretch: a row across the
 * vertex keeps its identity on the first part and the second part becomes a new row of the same
 * subject (a Split portion, `editingOriginFaceId` as today); the write-back divides the subject.
 */
export function splitEdge(primary, room, edgeId, at, vertex, createId) {
  const edge = room.edges.find((entry) => entry.id === edgeId);
  const length = edgeLength(room, edge);
  const next = { id: createId(), startId: vertex.id, endId: edge.endId };
  room.vertices.splice(room.vertices.findIndex((v) => v.id === edge.startId) + 1, 0, {
    ...vertex,
    ...cleanPoint({ x: vertex.x, y: vertex.y }),
  });
  room.edges.splice(room.edges.indexOf(edge) + 1, 0, next);
  edge.endId = vertex.id;
  const anchors = [];
  for (const anchor of primary.anchors) {
    if (anchor.roomId !== room.id || anchor.edgeId !== edgeId) {
      anchors.push(anchor);
      continue;
    }
    const to = anchor.to ?? length;
    const shifted = (from, end) => ({
      from: from - at,
      to: anchor.to == null ? null : end - at,
    });
    if (to <= at + SAME) anchors.push({ ...anchor, to: anchor.to == null ? at : anchor.to });
    else if (anchor.from >= at - SAME)
      anchors.push({ ...anchor, edgeId: next.id, ...shifted(anchor.from, to) });
    else {
      const origin = anchor.lineage?.editingOriginFaceId || anchor.faceId;
      const lineage = { ...(anchor.lineage || {}), editingOriginFaceId: origin };
      anchors.push({ ...anchor, to: at, lineage });
      const faceId = createId();
      // The new row follows its origin in the room's row order, as today.
      room.faceOrder?.splice(room.faceOrder.indexOf(anchor.faceId) + 1, 0, faceId);
      anchors.push({
        ...anchor,
        faceId,
        bindingId: null,
        edgeId: next.id,
        ...shifted(at, to),
        from: 0,
        lineage,
      });
    }
  }
  primary.anchors = anchors;
  return next;
}

/**
 * Remove a vertex on a straight run: the edge into it reaches on to the far end of the edge out
 * of it, whose rows move onto it (their stations shift by the first edge's length).
 */
export function joinEdges(primary, room, vertexId) {
  const into = room.edges.find((edge) => edge.endId === vertexId);
  const out = room.edges.find((edge) => edge.startId === vertexId);
  const shift = edgeLength(room, into);
  for (const anchor of primary.anchors) {
    if (anchor.roomId !== room.id) continue;
    if (anchor.edgeId === into.id && anchor.to == null) anchor.to = shift;
    if (anchor.edgeId !== out.id) continue;
    anchor.edgeId = into.id;
    anchor.from += shift;
    if (anchor.to != null) anchor.to += shift;
  }
  into.endId = out.endId;
  room.edges = room.edges.filter((edge) => edge !== out);
  room.vertices = room.vertices.filter((vertex) => vertex.id !== vertexId);
}
