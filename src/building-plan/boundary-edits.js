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
} from './geometry.js';
import {
  buildingPlanSegmentThickness,
  facesOfWall,
  findWall,
  equalValue,
  planIssue,
} from './model.js';

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
      const from = near(Math.min(...ranges), 0) ? 0 : Math.min(...ranges),
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
