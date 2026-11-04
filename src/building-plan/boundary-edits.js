import {
  GEOMETRY_EPSILON as EPS,
  at,
  dot,
  distance,
  near,
  polygonArea,
  polygonEdges,
  project,
  segmentFrame,
  add,
  multiply,
} from './geometry.js';
import {
  buildingPlanSegmentThickness,
  facesOfWall,
  findWall,
  equalValue,
  planIssue,
} from './model.js';

const host = (floor, room, edgeId) => {
  const face = room.faces.find((face) => face.edgeIds?.includes(edgeId));
  return face && findWall(floor, face.wallId);
};
/** Extend a partial propagation to a real connected corner, rather than creating a thickness-wide bay. */
export function sharedCornerMove(floor, referenceRoom, referenceEdge, room, edge, interval) {
  const edges = polygonEdges(room),
    index = edges.findIndex((item) => item.id === edge.id);
  const connections = [];
  const result = [...interval];
  for (const end of [0, 1]) {
    const gap = end ? edge.length - result[1] : result[0];
    if (gap <= EPS) continue;
    const adjacent = edges[(index + (end ? 1 : edges.length - 1)) % edges.length];
    for (const reference of polygonEdges(referenceRoom)) {
      if (
        Math.abs(dot(reference.tangent, referenceEdge.tangent)) > EPS ||
        dot(reference.tangent, adjacent.tangent) > -1 + EPS
      )
        continue;
      const range = [
        project(reference, adjacent.start).along,
        project(reference, adjacent.end).along,
      ].sort((a, b) => a - b);
      if (Math.min(reference.length, range[1]) - Math.max(0, range[0]) < -EPS) continue;
      const wall = host(floor, referenceRoom, reference.id);
      if (!wall) continue;
      const thickness = referenceRoom.faces
        .filter((face) => face.wallId === wall.id)
        .flatMap((face) => face.bindings)
        .filter(
          (binding) =>
            binding.edgeId === reference.id &&
            Math.min(binding.roomInterval[1], range[1]) -
              Math.max(binding.roomInterval[0], range[0]) >=
              -EPS
        )
        .map((binding) =>
          buildingPlanSegmentThickness(
            wall,
            wall.segments.find((segment) => segment.id === binding.segmentId)
          )
        )
        .find(
          (value) =>
            Number.isFinite(value) &&
            gap <= value + EPS &&
            near(
              project(reference, adjacent.start).offset,
              -Math.sign(polygonArea(referenceRoom.vertices)) * value
            )
        );
      if (!Number.isFinite(thickness)) continue;
      result[end] = end ? edge.length : 0;
      connections.push({
        roomId: room.id,
        edgeId: adjacent.id,
        referenceRoomId: referenceRoom.id,
        referenceEdgeId: reference.id,
        oldTangent: adjacent.tangent,
      });
      break;
    }
  }
  return { interval: result, connections };
}

/** A return that reverses at a shared corner switches to the other face of its stable wall axis. */
export function resolveReversedCorners(floor, connections) {
  for (const connection of connections) {
    const room = floor.rooms.find((item) => item.id === connection.roomId);
    const referenceRoom = floor.rooms.find((item) => item.id === connection.referenceRoomId);
    const identity = room.edges.find((item) => item.id === connection.edgeId);
    const start = room.vertices.find((item) => item.id === identity?.startId);
    const end = room.vertices.find((item) => item.id === identity?.endId);
    if (!start || !end || distance(start, end) <= EPS) continue;
    const edge = { ...identity, ...segmentFrame(start, end) };
    const reference = polygonEdges(referenceRoom).find(
      (item) => item.id === connection.referenceEdgeId
    );
    if (!edge || !reference || dot(edge.tangent, connection.oldTangent) > -1 + EPS) continue;
    const delta = multiply(reference.normal, -project(reference, edge.start).offset);
    for (const vertex of room.vertices)
      if (vertex.id === edge.start.id || vertex.id === edge.end.id)
        Object.assign(vertex, add(vertex, delta));
  }
}

/** Reconcile captured straight extents with their physical host, retaining its identity and fixed-end offsets. */
export function repairSharedWallExtents(floor, before) {
  for (const wall of floor.walls)
    for (const segment of wall.segments) {
      const oldWall = before.walls.find((item) => item.id === wall.id);
      const oldSegment = oldWall?.segments.find((item) => item.id === segment.id);
      if (!oldSegment) continue;
      const frame = segmentFrame(segment.start, segment.end),
        ranges = [];
      const linked = facesOfWall(floor, wall.id);
      for (const { room, face } of linked) {
        if (face.freePath) continue;
        const oldRoom = before.rooms.find((item) => item.id === room.id);
        const oldFace = oldRoom?.faces.find((item) => item.id === face.id);
        if (!oldFace) continue;
        for (const binding of oldFace.bindings.filter((item) => item.segmentId === segment.id)) {
          const oldEdge = polygonEdges(oldRoom).find((item) => item.id === binding.edgeId);
          const edge =
            polygonEdges(room).find((item) => item.id === binding.edgeId) ||
            (face.edgeIds?.length === 1
              ? polygonEdges(room).find((item) => item.id === face.edgeIds[0])
              : null);
          if (
            !oldEdge ||
            !edge ||
            !near(binding.roomInterval[0], 0) ||
            !near(binding.roomInterval[1], oldEdge.length) ||
            Math.abs(dot(frame.normal, edge.tangent)) > EPS
          )
            continue;
          const half =
            (buildingPlanSegmentThickness(wall, segment) ?? segment.referenceOffset * 2) / 2;
          if (
            !near(Math.abs(project(frame, edge.start).offset), half) ||
            !near(project(frame, edge.start).offset, project(frame, edge.end).offset)
          )
            continue;
          ranges.push(project(frame, edge.start).along, project(frame, edge.end).along);
        }
      }
      if (!ranges.length) continue;
      const from = Math.min(...ranges),
        to = Math.max(...ranges);
      if (to - from <= EPS) continue;
      segment.start = at(frame, from);
      segment.end = at(frame, to);
      for (const opening of [...wall.doors, ...wall.windows].filter(
        (item) => item.segmentId === segment.id
      ))
        opening.offset -= from;
    }
}

/** Return partial opening/facing intersections, combining portions of the same room before testing. */
export function partialOpeningCuts(snapshot) {
  const cuts = [];
  for (const floor of snapshot.floors)
    for (const wall of floor.walls)
      for (const opening of [...wall.doors, ...wall.windows])
        for (const room of floor.rooms) {
          const intervals = room.faces
            .filter((face) => face.wallId === wall.id)
            .flatMap((face) =>
              face.bindings.filter((b) => b.segmentId === opening.segmentId).map((b) => b.interval)
            )
            .sort((a, b) => a[0] - b[0]);
          const merged = [];
          for (const [from, to] of intervals) {
            const previous = merged.at(-1);
            if (previous && from <= previous[1] + EPS) previous[1] = Math.max(previous[1], to);
            else merged.push([from, to]);
          }
          const overlap = merged.reduce(
            (size, [from, to]) =>
              size +
              Math.max(
                0,
                Math.min(to, opening.offset + opening.width) - Math.max(from, opening.offset)
              ),
            0
          );
          if (overlap > EPS && overlap < opening.width - EPS)
            cuts.push({
              floorId: floor.id,
              wallId: wall.id,
              roomId: room.id,
              id: opening.id,
              type: opening.type,
              label: opening.values?.[`${opening.type}_label`] || opening.type,
              extent: merged,
              offset: opening.offset,
              width: opening.width,
              segmentId: opening.segmentId,
            });
        }
  return cuts;
}

/** Resizing a fully captured boundary cannot silently leave an uncovered physical extent. */
export function capturedBoundaryIssues(before, after) {
  const issues = [];
  for (const floor of after.floors)
    for (const room of floor.rooms) {
      const oldRoom = before.floors
        .find((item) => item.id === floor.id)
        ?.rooms.find((item) => item.id === room.id);
      if (oldRoom && equalValue(oldRoom.vertices, room.vertices)) continue;
      for (const edge of polygonEdges(room)) {
        const intervals = room.faces
          .flatMap((face) =>
            face.bindings
              .filter((binding) => binding.edgeId === edge.id)
              .map((binding) => binding.roomInterval)
          )
          .sort((a, b) => a[0] - b[0]);
        if (!intervals.length) continue; // Uncaptured wall information remains distinct from invalid geometry.
        let end = 0,
          gap = false;
        for (const [from, to] of intervals) {
          if (from > end + EPS) gap = true;
          end = Math.max(end, to);
        }
        if (gap || end < edge.length - EPS)
          issues.push(
            planIssue(
              'incomplete_boundary_binding',
              'The wall does not reach the changed room corner. Try a smaller edit or capture the missing wall extent.',
              { type: 'room', id: room.id },
              { edgeId: edge.id }
            )
          );
      }
    }
  return issues;
}
