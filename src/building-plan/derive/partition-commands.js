import { cleanPoint } from '../geometry.js';
import { copyBuildingPlanData as copy } from '../model.js';
import { createWallSides } from '../wall-sides.js';
import { SAME, lineFrame } from './grid.js';
import { movePartitionPortion } from './partition-portions.js';

const refuse = (code, message, details = {}) => {
  throw Object.assign(new Error(message), { issues: [{ code, message, ...details }] });
};
const all = (primary) => primary.rooms.map((room) => room.id);

/** A new wall subject with the given answers; its reference row is the partition's. */
function partitionSubject(id, faceId, { overrides = {}, values = {} }, createId) {
  return {
    id,
    overrides: copy(overrides),
    properties: {},
    provenance: {},
    values: copy(values),
    referenceFaceId: faceId,
    segmentId: createId(),
    segmentFlags: {},
    lastWidth: 0,
    sides: createWallSides(createId).map(({ roomId: _, ...side }) => side),
    openings: [],
  };
}

/** The drawn points as straight runs: zero-length edges and collinear middle points dropped. */
function straightRuns(points) {
  const kept = [];
  for (const point of points) {
    const last = kept.at(-1);
    if (last && Math.hypot(point.x - last.x, point.y - last.y) <= SAME) continue;
    const before = kept.at(-2);
    const frame = before && lineFrame(before, last);
    const turn = frame && lineFrame(last, point);
    if (
      frame &&
      turn &&
      Math.abs(frame.tangent.x * turn.normal.x + frame.tangent.y * turn.normal.y) <= 1e-9 &&
      frame.tangent.x * turn.tangent.x + frame.tangent.y * turn.tangent.y > 0
    )
      kept.pop();
    kept.push(point);
  }
  return kept.slice(0, -1).map((start, index) => [start, kept[index + 1]]);
}

/**
 * `create_wall` (rule 13): a free path inside a room, with a new wall taking the operation's ID
 * and answers; the body lies on side +1 of the path, as today. Each straight run is a partition
 * row of that wall; the write-back divides the wall per run (W9, W9.1, ...), as today's engine
 * separates runs.
 */
function createWall(primary, operation, { createId }) {
  const room = primary.rooms.find((entry) => entry.id === operation.roomId);
  if (!room) throw new Error('The room no longer exists.');
  if (!Array.isArray(operation.vertices) || operation.vertices.length < 2)
    refuse('invalid_wall_geometry', 'Draw at least two distinct wall points.');
  const runs = straightRuns(operation.vertices.map((point) => cleanPoint(point)));
  if (!runs.length) refuse('invalid_wall_geometry', 'Draw at least two distinct wall points.');
  const faceIds = runs.map(() => createId());
  const id = operation.id || createId();
  primary.subjects.set(id, partitionSubject(id, faceIds[0], operation, createId));
  runs.forEach(([start, end], index) => {
    primary.partitions.push({
      roomId: room.id,
      faceId: faceIds[index],
      subjectId: id,
      path: [start, end].map((point) => ({ ...point, id: point.id || createId() })),
      freeEdges: [createId()],
      sides: [1],
      bindingIds: [null],
      ...(runs.length > 1 ? { lineage: { jogOriginFaceId: faceIds[0] } } : {}),
    });
    room.faceOrder?.push(faceIds[index]);
  });
  return {
    result: {
      created: { type: 'wall', id },
      createdFace: { type: 'room_face', id: faceIds[0] },
    },
    preferredRoomIds: all(primary),
  };
}

/**
 * `update_wall` (rule 13) on a whole partition: its path moves, with the same number of points.
 * An opening keeps its distance from the path's start, or from its end when only the start moved
 * (or the operation anchors it at the end), as today.
 */
function updateWall(primary, operation, { createId }) {
  const partition = primary.partitions.find((entry) => entry.faceId === operation.faceId);
  if (partition?.path.some((point) => point.editingCutId))
    return movePartitionPortion(primary, partition, operation, { createId });
  const rows = [
    ...primary.anchors.filter((anchor) => anchor.subjectId === operation.wallId),
    ...primary.partitions.filter((entry) => entry.subjectId === operation.wallId),
  ];
  const own = rows.length === 1 && primary.partitions.includes(rows[0]) ? rows[0] : null;
  if (!own)
    refuse('wall_boundary_edit_required', 'Edit a boundary wall using its room-facing edge.');
  if (!Array.isArray(operation.vertices) || operation.vertices.length !== own.path.length)
    refuse(
      'wall_topology_edit_required',
      'Use split/join operations to change the number of wall segments.'
    );
  const [oldStart, oldEnd] = [own.path[0], own.path.at(-1)];
  own.path = operation.vertices.map((point, index) =>
    cleanPoint({ ...own.path[index], ...point, id: own.path[index].id })
  );
  const moved = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) > SAME;
  const keepEnd =
    operation.anchor === 'end' ||
    (!operation.anchor && moved(oldStart, own.path[0]) && !moved(oldEnd, own.path.at(-1)));
  if (keepEnd) {
    const [before, after] = [
      lineFrame(oldStart, oldEnd)?.length,
      lineFrame(own.path[0], own.path.at(-1))?.length,
    ];
    for (const opening of primary.subjects.get(own.subjectId)?.openings || [])
      if (opening.faceId === own.faceId) opening.from += (after ?? 0) - (before ?? 0);
  }
  return { result: {}, preferredRoomIds: all(primary) };
}

/**
 * `remove_face` (rule 15) on a partition row: the row goes, and its wall with it when the wall
 * has no other row, openings included. A room's boundary rows follow its outline (K1, pending).
 */
function removeFace(primary, operation) {
  const partition = primary.partitions.find((entry) => entry.faceId === operation.faceId);
  if (!partition) {
    if (!primary.anchors.some((anchor) => anchor.faceId === operation.faceId))
      throw new Error('The wall face no longer exists.');
    refuse(
      'boundary_row_required',
      "A room's boundary walls follow its outline. Reshape or remove the room instead."
    );
  }
  primary.partitions = primary.partitions.filter((entry) => entry !== partition);
  const room = primary.rooms.find((entry) => entry.id === partition.roomId);
  if (room.faceOrder) room.faceOrder = room.faceOrder.filter((id) => id !== partition.faceId);
  const id = partition.subjectId;
  const others =
    primary.partitions.some((entry) => entry.subjectId === id) ||
    primary.anchors.some((anchor) => anchor.subjectId === id);
  if (!others) primary.subjects.delete(id);
  else {
    const subject = primary.subjects.get(id);
    subject.openings = subject.openings.filter((opening) => opening.faceId !== partition.faceId);
  }
  return { result: {}, preferredRoomIds: all(primary) };
}

/** The partition operations on the derived core (item 4d), by operation type. */
export const PARTITION_COMMANDS = Object.freeze({
  create_wall: createWall,
  update_wall: updateWall,
  remove_face: removeFace,
});
