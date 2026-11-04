import {
  GEOMETRY_EPSILON as EPS,
  at,
  dot,
  near,
  polygonArea,
  polygonEdges,
  project,
  segmentFrame,
} from './geometry.js';
import { buildingPlanSegmentThickness, facesOfWall } from './model.js';
import { remapSubject } from './topology.js';

/** Reconcile current captured construction with its declared faces, retaining subject identity.
 * Interior construction divisions and independently authored partitions are preserved. Openings
 * keep their metric locations; dated source geometry belongs to observations and is not rewritten.
 */
export function reconcileWallExtents(floor, wallIds, { retireUnbound = false } = {}) {
  for (const wall of floor.walls.filter((entry) => wallIds.has(entry.id))) {
    const linked = facesOfWall(floor, wall.id);
    if (!linked.length || linked.some(({ face }) => face.freePath)) continue;
    const previous = wall.segments.map((segment) => ({ ...segment }));
    const retired = new Set();
    for (const segment of wall.segments) {
      const frame = segmentFrame(segment.start, segment.end);
      const half =
        (buildingPlanSegmentThickness(wall, segment) ?? (segment.referenceOffset ?? 0) * 2) / 2;
      let minimum = -Infinity,
        maximum = Infinity;
      for (const other of previous.filter((entry) => entry.id !== segment.id)) {
        const a = project(frame, other.start),
          b = project(frame, other.end);
        if (!near(a.offset, 0) || !near(b.offset, 0)) continue;
        if (Math.max(a.along, b.along) <= EPS) minimum = 0;
        if (Math.min(a.along, b.along) >= frame.length - EPS) maximum = frame.length;
      }
      const ranges = [];
      for (const { room, face } of linked)
        for (const edge of polygonEdges(room).filter((edge) => face.edgeIds?.includes(edge.id))) {
          if (Math.abs(dot(frame.normal, edge.tangent)) > EPS) continue;
          const a = project(frame, edge.start),
            b = project(frame, edge.end);
          const side = dot(frame.tangent, edge.tangent) > 0 ? 1 : -1;
          if (
            !near(a.offset, side * Math.sign(polygonArea(room.vertices)) * half) ||
            !near(a.offset, b.offset)
          )
            continue;
          const from = Math.max(minimum, Math.min(a.along, b.along));
          const to = Math.min(maximum, Math.max(a.along, b.along));
          if (to - from > EPS && Math.min(to, frame.length) - Math.max(from, 0) > EPS)
            ranges.push([from, to]);
        }
      const openings = [...wall.doors, ...wall.windows].filter(
        (entry) => entry.segmentId === segment.id
      );
      if (!ranges.length) {
        if (retireUnbound && !openings.length) retired.add(segment.id);
        continue;
      }
      const from = Math.min(
        ...ranges.map((range) => range[0]),
        ...openings.map((opening) => opening.offset)
      );
      const to = Math.max(
        ...ranges.map((range) => range[1]),
        ...openings.map((opening) => opening.offset + opening.width)
      );
      if (near(from, 0) && near(to, frame.length)) continue;
      segment.start = at(frame, from);
      segment.end = at(frame, to);
      for (const opening of openings) opening.offset -= from;
    }
    for (const id of retired) remapSubject(floor, id, wall.id, 'wall');
    wall.segments = wall.segments.filter((segment) => !retired.has(segment.id));
  }
}
