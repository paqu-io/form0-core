import { cleanPoint, polygonIssue } from '../geometry.js';
import { copyBuildingPlanData as copy, equalValue } from '../model.js';
import { SAME, along } from './grid.js';
import { deriveBuildingPlanPieces } from './pieces.js';
import { roomLines } from './room-lines.js';
import { resizeFace } from './face-commands.js';

const refuse = (code, message, details = {}) => {
  throw Object.assign(new Error(message), { issues: [{ code, message, ...details }] });
};
const near = (a, b) => Math.abs(a - b) <= SAME;
const bounds = (vertices) => {
  const xs = vertices.map((p) => p.x);
  const ys = vertices.map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
};
const edgeLength = (room, edge) => {
  const [p, q] = [edge.startId, edge.endId].map((id) => room.vertices.find((v) => v.id === id));
  return Math.hypot(q.x - p.x, q.y - p.y);
};

/** The room line through the middle of a stretch, as a key `roomId:index`, if any. */
function lineKeyThrough(primary, roomId, middle) {
  const lines = roomLines(primary.rooms.find((room) => room.id === roomId));
  const index = lines.findIndex(
    (line) =>
      Math.abs(
        (middle.x - line.frame.start.x) * line.frame.normal.x +
          (middle.y - line.frame.start.y) * line.frame.normal.y
      ) <= SAME &&
      along(line.frame, middle) > -SAME &&
      along(line.frame, middle) < line.frame.length + SAME
  );
  return index < 0 ? null : `${roomId}:${index}`;
}

/**
 * Several face drags in one command, derived and written back once. Explicit widths name room
 * lines, which later drags renumber: each is kept by the middle of its line and named again at
 * the end. Returns the rooms none of the drags edited.
 */
function combineDrags(primary, options) {
  const kept = [];
  const stationary = [];
  return {
    drag(step) {
      stationary.push(resizeFace(primary, step, options).preferredRoomIds);
      for (const entry of primary.contactWidths || [])
        kept.push({
          width: entry.width,
          middles: entry.lines.map((key) => {
            const cut = key.lastIndexOf(':');
            const roomId = key.slice(0, cut);
            const line = roomLines(primary.rooms.find((room) => room.id === roomId))[
              Number(key.slice(cut + 1))
            ];
            return {
              roomId,
              point: {
                x: (line.frame.start.x + line.frame.end.x) / 2,
                y: (line.frame.start.y + line.frame.end.y) / 2,
              },
            };
          }),
        });
    },
    finish() {
      primary.contactWidths = kept
        .map((entry) => ({
          width: entry.width,
          lines: entry.middles.map(({ roomId, point }) => lineKeyThrough(primary, roomId, point)),
        }))
        .filter((entry) => entry.lines.every(Boolean));
      return stationary.reduce((all, ids) => all.filter((id) => ids.includes(id)));
    },
  };
}

/**
 * `resize_room` on the derived core. A room sharing no wall scales to the new bounds (its
 * partitions with it; rows and openings keep their proportional place). A room sharing walls
 * moves each changed side as a face drag, all in one command.
 */
export function resizeRoom(primary, operation, options) {
  const room = primary.rooms.find((entry) => entry.id === operation.roomId);
  if (!room) throw new Error('The room no longer exists.');
  const rectangle = operation.rectangle;
  if (
    !rectangle ||
    !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(rectangle[key])) ||
    rectangle.width <= SAME ||
    rectangle.height <= SAME
  )
    refuse('invalid_rectangle', 'The room bounds must have positive finite dimensions.');
  const old = bounds(room.vertices);
  const derived = deriveBuildingPlanPieces(primary, options.specifications);
  const shared = derived.pieces.some(
    (piece) => piece.lines.length > 1 && piece.lines.some((line) => line.roomId === room.id)
  );
  if (!shared) {
    scaleRoom(primary, room, old, rectangle);
    return {
      result: {},
      preferredRoomIds: primary.rooms.map((entry) => entry.id).filter((id) => id !== room.id),
    };
  }
  const sides = [
    { axis: 'x', at: old.x, delta: rectangle.x - old.x, sign: -1 },
    {
      axis: 'x',
      at: old.x + old.width,
      delta: rectangle.x + rectangle.width - old.x - old.width,
      sign: 1,
    },
    { axis: 'y', at: old.y, delta: rectangle.y - old.y, sign: -1 },
    {
      axis: 'y',
      at: old.y + old.height,
      delta: rectangle.y + rectangle.height - old.y - old.height,
      sign: 1,
    },
  ].filter((side) => Math.abs(side.delta) > SAME);
  const steps = sides.map((side) => {
    const current = primary.rooms.find((entry) => entry.id === room.id);
    const edge = current.edges.find((entry) =>
      [entry.startId, entry.endId]
        .map((id) => current.vertices.find((v) => v.id === id))
        .every((p) => near(p[side.axis], side.at))
    );
    const anchor =
      edge && primary.anchors.find((entry) => entry.edgeId === edge.id && entry.roomId === room.id);
    if (!anchor)
      refuse(
        'ambiguous_room_resize',
        'Use a specific face handle to resize this non-rectangular room.'
      );
    return {
      ...operation,
      type: 'resize_face',
      faceId: anchor.faceId,
      edgeId: edge.id,
      distance: side.sign * side.delta,
    };
  });
  // Each side was found in the geometry before any moved; rows keep their IDs as sides move.
  const drags = combineDrags(primary, options);
  for (const step of steps) drags.drag(step);
  return { result: {}, preferredRoomIds: drags.finish() };
}

/** A room sharing no wall scales to `rectangle`; rows and openings keep their place in proportion. */
function scaleRoom(primary, room, old, rectangle) {
  const scale = (p) =>
    cleanPoint({
      ...p,
      x: rectangle.x + ((p.x - old.x) * rectangle.width) / old.width,
      y: rectangle.y + ((p.y - old.y) * rectangle.height) / old.height,
    });
  const lengths = new Map(room.edges.map((edge) => [edge.id, edgeLength(room, edge)]));
  room.vertices = room.vertices.map(scale);
  const problem = polygonIssue(room.vertices);
  if (problem) refuse('invalid_room_geometry', problem);
  for (const partition of primary.partitions)
    if (partition.roomId === room.id) partition.path = partition.path.map(scale);
  const ratio = new Map(
    room.edges.map((edge) => [edge.id, edgeLength(room, edge) / lengths.get(edge.id)])
  );
  for (const anchor of primary.anchors) {
    if (anchor.roomId !== room.id || anchor.to == null) continue;
    anchor.from *= ratio.get(anchor.edgeId);
    anchor.to *= ratio.get(anchor.edgeId);
  }
  const first = new Map();
  for (const anchor of primary.anchors)
    if (!first.has(anchor.faceId)) first.set(anchor.faceId, anchor);
  for (const subject of primary.subjects.values())
    for (const opening of subject.openings || []) {
      const anchor = first.get(opening.faceId);
      if (anchor?.roomId !== room.id) continue;
      const k = ratio.get(anchor.edgeId);
      const length = lengths.get(anchor.edgeId) * k;
      const start = (opening.from + opening.width / 2) * k - opening.width / 2;
      if (start < -SAME || start + opening.width > length + SAME)
        refuse(
          'opening_crosses_edit_boundary',
          'An opening no longer fits its wall. Move it first.'
        );
      opening.from = start;
    }
}

/**
 * `resize_preserve_group` on the derived core: the face drag moves the whole shared wall, and each
 * preserved room it reaches keeps its size by moving its other sides too (rooms beyond follow).
 * A room outside `affectedRoomIds` must not change.
 */
export function resizePreserveGroup(primary, operation, options) {
  if (!Array.isArray(operation.affectedRoomIds) || !operation.affectedRoomIds.length)
    refuse('affected_group_required', 'Explicitly identify the affected room group.');
  const before = copy(primary.rooms);
  const step = { ...operation, type: 'resize_face', sharedWallDrag: 'move_wall' };
  const drags = combineDrags(primary, options);
  drags.drag(step);
  const preserve = new Set(operation.preserveRoomIds || []);
  const done = new Set();
  for (let changed = true; changed; ) {
    changed = false;
    for (const roomId of preserve) {
      if (done.has(roomId)) continue;
      const room = primary.rooms.find((entry) => entry.id === roomId);
      const old = before.find((entry) => entry.id === roomId);
      const moved = room.vertices.find((p) => {
        const was = old.vertices.find((entry) => entry.id === p.id);
        return was && Math.hypot(p.x - was.x, p.y - was.y) > SAME;
      });
      if (!moved) continue;
      if (room.vertices.length !== old.vertices.length)
        refuse(
          'group_requires_whole_face',
          'Size-preserving group edits require a complete shared face.'
        );
      const was = old.vertices.find((entry) => entry.id === moved.id);
      const delta = { x: moved.x - was.x, y: moved.y - was.y };
      // Every other side of the preserved room moves by the same displacement.
      for (const line of roomLines(old)) {
        const outward = {
          x: line.frame.normal.x * line.outward,
          y: line.frame.normal.y * line.outward,
        };
        const distance = outward.x * delta.x + outward.y * delta.y;
        const current = roomLines(room).find((entry) => {
          const p = { x: line.frame.start.x + delta.x, y: line.frame.start.y + delta.y };
          return (
            Math.abs(
              (p.x - entry.frame.start.x) * entry.frame.normal.x +
                (p.y - entry.frame.start.y) * entry.frame.normal.y
            ) <= SAME &&
            entry.frame.tangent.x * line.frame.tangent.x +
              entry.frame.tangent.y * line.frame.tangent.y >
              0
          );
        });
        if (Math.abs(distance) <= SAME || current) continue;
        const edge = line.edges[0];
        const anchor = primary.anchors.find(
          (entry) => entry.roomId === roomId && entry.edgeId === edge.id
        );
        if (!anchor) continue;
        drags.drag({
          ...step,
          faceId: anchor.faceId,
          edgeId: edge.id,
          distance,
          interval: undefined,
        });
      }
      done.add(roomId);
      changed = true;
    }
  }
  const allowed = new Set(operation.affectedRoomIds);
  const outside = primary.rooms.filter((room) => {
    if (allowed.has(room.id)) return false;
    const old = before.find((entry) => entry.id === room.id);
    return !equalValue(old?.vertices, room.vertices);
  });
  if (outside.length)
    refuse(
      'outside_affected_group',
      'The operation would change rooms outside the supplied group.',
      {
        roomIds: outside.map((room) => room.id),
      }
    );
  return { result: {}, preferredRoomIds: drags.finish() };
}
