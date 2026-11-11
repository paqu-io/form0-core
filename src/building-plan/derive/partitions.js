import { lineFrame, pointAt } from './grid.js';
import { resolveWallThickness } from './thickness.js';

/**
 * Pieces of internal partitions: one per path edge, with the same room on both sides. The axis
 * lies half the width from the face path, on the side of the wall body.
 */
export function derivePartitionPieces(primary, specifications) {
  const pieces = [];
  const issues = [];
  for (const partition of primary.partitions) {
    const subject = primary.subjects.get(partition.subjectId) || null;
    const roomIds = [partition.roomId, partition.roomId];
    const resolved = resolveWallThickness(primary.floor, specifications, subject, roomIds);
    const thickness = resolved.conflict ? null : resolved.value;
    const offset = subject?.segments?.[0]?.referenceOffset;
    const width = thickness > 0 ? thickness : Number.isFinite(offset) ? offset * 2 : 0;
    for (let i = 0; i < partition.path.length - 1; i++) {
      const frame = lineFrame(partition.path[i], partition.path[i + 1]);
      const side = partition.sides[i];
      if (!frame) continue;
      if (side == null) {
        issues.push({ code: 'unbound_partition_edge', subjectId: partition.subjectId });
        continue;
      }
      const distance = (-side * width) / 2;
      pieces.push({
        subjectId: partition.subjectId,
        roomIds,
        exposure: 'interior',
        thickness,
        width,
        faceIds: [partition.faceId, null],
        partition: true,
        line: { roomId: partition.roomId, from: 0, to: frame.length },
        axis: { start: pointAt(frame, 0, distance), end: pointAt(frame, frame.length, distance) },
      });
    }
  }
  return { pieces, issues };
}
