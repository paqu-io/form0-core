import {
  GEOMETRY_EPSILON as EPS,
  at,
  dot,
  near,
  polygonEdges,
  project,
  segmentFrame,
} from './geometry.js';
import { buildingPlanSegmentThickness } from './model.js';
import { junctionIntersection } from './junction-edits.js';

/**
 * Geometric wall incidence, independent of physical subject grouping. Axis stations
 * include room-facing coverage; junction stations describe where supporting axes meet.
 * The network is derived, so no additional collected rows or persisted editor state exist.
 */
export function createBuildingPlanAxisNetwork(floor) {
  const runs = [],
    partitions = [];
  for (const room of floor.rooms) {
    const edges = polygonEdges(room);
    for (const face of room.faces) {
      const facingEdges = face.freePath
        ? face.freePath.slice(0, -1).map((start, i) => ({
            id: face.freeEdges[i],
            ...segmentFrame(start, face.freePath[i + 1]),
          }))
        : edges;
      const wall = floor.walls.find((w) => w.id === face.wallId);
      for (const binding of face.bindings) {
        const edge = facingEdges.find((e) => e.id === binding.edgeId),
          segment = wall.segments.find((s) => s.id === binding.segmentId);
        if (!edge || !segment) continue;
        const physical = segmentFrame(segment.start, segment.end),
          half = (buildingPlanSegmentThickness(wall, segment) ?? segment.referenceOffset * 2) / 2;
        const start = at(physical, binding.interval[binding.direction > 0 ? 0 : 1]),
          end = at(physical, binding.interval[binding.direction > 0 ? 1 : 0]);
        const axis = segmentFrame(start, end);
        (face.freePath ? partitions : runs).push({
          room,
          face,
          wall,
          segment,
          binding,
          edge,
          axis,
          physical,
          half,
          side: binding.side * binding.direction,
          span: [0, axis.length],
        });
      }
    }
  }
  for (const run of runs) {
    const edges = polygonEdges(run.room),
      index = edges.findIndex((e) => e.id === run.edge.id);
    for (const end of [0, 1]) {
      if (!near(run.binding.roomInterval[end], end ? run.edge.length : 0)) continue;
      const adjacent = edges[(index + (end ? 1 : edges.length - 1)) % edges.length];
      const other = runs.find(
        (r) =>
          r.room.id === run.room.id &&
          r.edge.id === adjacent.id &&
          near(r.binding.roomInterval[end ? 0 : 1], end ? 0 : adjacent.length)
      );
      if (!other) continue;
      const point = junctionIntersection(run.axis, other.axis);
      if (point) run.span[end] = project(run.axis, point).along;
    }
    if (run.span[1] - run.span[0] <= EPS) run.span = [0, run.axis.length];
  }
  const collinear = (a, b) =>
    Math.abs(dot(a.normal, b.tangent)) <= EPS && Math.abs(project(a, b.start).offset) <= EPS;
  function users(source, span = source.span) {
    const a = at(source.axis, span[0]),
      b = at(source.axis, span[1]);
    return runs.flatMap((run) => {
      if (!collinear(source.axis, run.axis)) return [];
      const range = [project(run.axis, a).along, project(run.axis, b).along].sort((a, b) => a - b);
      const low = Math.max(range[0], run.span[0]),
        high = Math.min(range[1], run.span[1]);
      if (high - low <= EPS) return [];
      const whole = range[0] <= run.span[0] + EPS && range[1] >= run.span[1] - EPS;
      const interval = whole
        ? [...run.binding.roomInterval]
        : [low, high]
            .map((s) => project(run.edge, at(run.axis, s, run.side * run.half)).along)
            .sort((a, b) => a - b);
      interval[0] = Math.max(run.binding.roomInterval[0], interval[0]);
      interval[1] = Math.min(run.binding.roomInterval[1], interval[1]);
      return interval[1] - interval[0] > EPS ? [{ run, interval, whole }] : [];
    });
  }
  function roomsForSegment(wall, segment) {
    if (!runs.some((run) => run.wall.id === wall.id && run.segment.id === segment.id)) return [];
    const frame = segmentFrame(segment.start, segment.end);
    const half = (buildingPlanSegmentThickness(wall, segment) ?? segment.referenceOffset * 2) / 2;
    return [
      ...new Set([
        ...runs
          .filter((run) => run.wall.id === wall.id && run.segment.id === segment.id)
          .map((run) => run.room.id),
        ...runs
          .filter((run) => {
            if (!collinear(frame, run.axis) || !near(run.half, half)) return false;
            const range = run.span
              .map((s) => project(frame, at(run.axis, s)).along)
              .sort((a, b) => a - b);
            return Math.min(frame.length, range[1]) - Math.max(0, range[0]) > EPS;
          })
          .map((run) => run.room.id),
      ]),
    ];
  }
  function roomsAtJunction(a, b, point) {
    const reach = Math.max(a.thickness || 0, b.thickness || 0);
    const incident = runs.filter((run) =>
      [a, b].some(
        (ref) =>
          collinear(run.axis, ref.axis || ref) &&
          project(run.axis, point).along >= run.span[0] - reach - EPS &&
          project(run.axis, point).along <= run.span[1] + reach + EPS
      )
    );
    const rooms = new Set(incident.map((run) => run.room.id));
    // A short profile shoulder has two nearby junctions. Its cap belongs to the
    // rooms on both incident bands, even when thickness offsets their axes.
    for (const run of incident)
      for (const adjacent of runs.filter(
        (other) =>
          other.room.id === run.room.id &&
          other.edge.id !== run.edge.id &&
          [other.edge.start.id, other.edge.end.id].some(
            (id) => id === run.edge.start.id || id === run.edge.end.id
          )
      )) {
        const joint = junctionIntersection(run.axis, adjacent.axis);
        if (!joint || Math.hypot(joint.x - point.x, joint.y - point.y) > reach + EPS) continue;
        for (const user of users(adjacent)) rooms.add(user.run.room.id);
      }
    return [...rooms];
  }
  return { runs, partitions, users, collinear, roomsForSegment, roomsAtJunction };
}
