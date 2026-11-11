import { copyBuildingPlanData as copy } from '../model.js';
import { SAME } from './grid.js';

/** The cap covering an output edge without a piece (see `assembleRows`). */
export function capOf(context, roomId, output) {
  return context.caps.find(
    (cap) =>
      cap.roomId === roomId &&
      output.line &&
      cap.index === output.line.index &&
      cap.from - SAME <= output.from &&
      output.to <= cap.to + SAME
  );
}

/**
 * Room-facing rows: one per straight facing extent (one per output edge covered by a piece, and
 * one per partition edge). The row on an edge that kept its ID keeps its own ID, binding ID and
 * lineage, and moves to the edge's subject. A row on a new part of a divided edge copies the
 * origin row's lineage with `jogOriginFaceId`, as today; a brand-new edge gets a new row. Rows
 * keep their order in the room; new rows follow their origin.
 *
 * @returns {Array<Object>} Row skeletons: {id, roomId, edgeId, wallId, bindingId, lineage,
 *   partition?}; bindings and sides are added with the wall geometry.
 */
export function assembleRows(context, rebuilt) {
  const rows = [];
  for (const { room, outputs } of rebuilt) {
    const order = new Map((room.faceOrder || []).map((id, index) => [id, index]));
    const roomRows = [];
    outputs.forEach((output, position) => {
      if (!output.piece) {
        if (output.line && !capOf(context, room.id, output))
          context.issues.push({ code: 'uncovered_edge', roomId: room.id, edgeId: output.id });
        return;
      }
      const origin = output.sources
        .map((source) => context.anchorByEdge.get(`${room.id}:${source.edgeId}`))
        .find(Boolean);
      const own = context.anchorByEdge.get(`${room.id}:${output.id}`);
      const anchor = own && output.sources.some((s) => s.edgeId === output.id) ? own : null;
      const lineage = copy((anchor || origin)?.lineage);
      const row = {
        id: anchor ? anchor.faceId : context.createId(),
        roomId: room.id,
        edgeId: output.id,
        wallId: output.piece.subjectId,
        bindingId: anchor?.bindingId || context.createId(),
        ...(lineage ? { lineage } : {}),
        order: anchor
          ? (order.get(anchor.faceId) ?? Infinity)
          : origin
            ? (order.get(origin.faceId) ?? Infinity) + 0.5
            : Infinity,
        position,
      };
      if (output.split && origin)
        row.lineage = {
          ...row.lineage,
          jogOriginFaceId: origin.lineage?.jogOriginFaceId || origin.faceId,
        };
      roomRows.push(row);
    });
    for (const piece of context.partitionPieces) {
      const partition = context.partitionByFace.get(piece.faceIds[0]);
      if (!partition || partition.roomId !== room.id) continue;
      const index = partition.freeEdges.indexOf(piece.edgeId);
      roomRows.push({
        id: partition.faceId,
        roomId: room.id,
        edgeId: piece.edgeId,
        wallId: piece.subjectId,
        bindingId: partition.bindingIds[index] || context.createId(),
        ...(partition.lineage ? { lineage: copy(partition.lineage) } : {}),
        partition,
        order: order.get(partition.faceId) ?? Infinity,
        position: Infinity,
      });
    }
    roomRows.sort((a, b) => a.order - b.order || a.position - b.position);
    rows.push(...roomRows);
  }
  return rows;
}
