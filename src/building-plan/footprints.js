import {
  add,
  at,
  cross,
  multiply,
  polygonArea,
  segmentFrame,
  subtract,
  distance,
  polygonsOverlap,
} from './geometry.js';
import { buildingPlanSegmentThickness, planIssue } from './model.js';
import { createBuildingPlanAxisNetwork } from './axis-network.js';
import { junctionIntersection } from './junction-edits.js';

const EPS = 1e-9;
const area = (points) => Math.abs(polygonArea(points));
const rect = (frame, from, to, half) => [
  at(frame, from, half),
  at(frame, to, half),
  at(frame, to, -half),
  at(frame, from, -half),
];

function halfPlane(points, start, end, side) {
  const result = [];
  const direction = subtract(end, start);
  const signed = (p) => side * cross(direction, subtract(p, start));
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const da = signed(a),
      db = signed(b);
    if (da >= -EPS) result.push(a);
    if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS))
      result.push(add(a, multiply(subtract(b, a), da / (da - db))));
  }
  return result.length >= 3 && area(result) > EPS * EPS ? result : [];
}

// The input and each result are convex. Keeping disjoint pieces avoids a renderer-specific
// boolean/path API, internal strokes, and a second persisted geometry representation.
function subtractConvex(subject, clip) {
  const bounds = (points) => ({
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  });
  const a = bounds(subject),
    b = bounds(clip);
  if (
    a.maxX <= b.minX + EPS ||
    b.maxX <= a.minX + EPS ||
    a.maxY <= b.minY + EPS ||
    b.maxY <= a.minY + EPS
  )
    return [subject];
  const side = Math.sign(polygonArea(clip));
  const result = [];
  let remaining = subject;
  for (let i = 0; i < clip.length && remaining.length; i++) {
    const start = clip[i],
      end = clip[(i + 1) % clip.length];
    const outside = halfPlane(remaining, start, end, -side);
    if (outside.length) result.push(outside);
    remaining = halfPlane(remaining, start, end, side);
  }
  return result;
}

function triangles(vertices) {
  const points = vertices.map(({ x, y }) => ({ x, y }));
  const side = Math.sign(polygonArea(points));
  const turn = (a, b, c) => side * cross(subtract(b, a), subtract(c, b));
  const result = [];
  while (points.length > 3) {
    const index = points.findIndex((b, i) => {
      const a = points[(i + points.length - 1) % points.length];
      const c = points[(i + 1) % points.length];
      if (Math.abs(turn(a, b, c)) <= EPS) return true;
      return (
        turn(a, b, c) > 0 &&
        !points.some(
          (p) =>
            p !== a &&
            p !== b &&
            p !== c &&
            turn(a, b, p) >= -EPS &&
            turn(b, c, p) >= -EPS &&
            turn(c, a, p) >= -EPS
        )
      );
    });
    if (index < 0) throw new Error('Cannot project an invalid room polygon.');
    const a = points[(index + points.length - 1) % points.length];
    const b = points[index],
      c = points[(index + 1) % points.length];
    if (Math.abs(turn(a, b, c)) > EPS) result.push([a, b, c]);
    points.splice(index, 1);
  }
  if (area(points) > EPS * EPS) result.push(points);
  return result;
}

function addWallCorner(walls, incoming, outgoing, point, a, b, side, register = () => {}) {
  if (!(a?.thickness > 0 && b?.thickness > 0)) return;
  const denominator = cross(incoming.tangent, outgoing.tangent);
  if (denominator * side <= EPS) return;
  const qa = add(point, multiply(incoming.normal, -side * a.thickness));
  const qb = add(point, multiply(outgoing.normal, -side * b.thickness));
  const along = cross(subtract(qb, qa), outgoing.tangent) / denominator;
  const intersection = add(qa, multiply(incoming.tangent, along));
  const miter = Math.hypot(intersection.x - point.x, intersection.y - point.y);
  const polygon =
    miter <= 4 * Math.max(a.thickness, b.thickness)
      ? [point, qa, intersection, qb]
      : [point, qa, qb];
  walls.get(a.wall.id).polygons.push(polygon);
  register(polygon);
}

/** Derived metric wall material and canonical openings; never writes to the semantic model. */
export function buildingPlanFootprints(floor, gridSize, { boundaryOnly = false } = {}) {
  const pixels = (p) => ({ x: p.x * gridSize, y: p.y * gridSize });
  const walls = new Map();
  const network = createBuildingPlanAxisNetwork(floor);
  const clipsByPolygon = new WeakMap(),
    axesByPolygon = new WeakMap();
  const openings = [];
  const boundaryRooms = new Map(floor.walls.map((wall) => [wall.id, new Set()]));
  for (const room of floor.rooms)
    for (const face of room.faces) if (!face.freePath) boundaryRooms.get(face.wallId).add(room.id);
  for (const wall of floor.walls) {
    const entry = {
      id: wall.id,
      polygons: [],
      schematicSegments: [],
      roomIds: [...boundaryRooms.get(wall.id)],
    };
    walls.set(wall.id, entry);
    for (const segment of wall.segments) {
      if (
        boundaryOnly &&
        !network.runs.some((run) => run.wall.id === wall.id && run.segment.id === segment.id)
      )
        continue;
      const frame = segmentFrame(segment.start, segment.end);
      const thickness = buildingPlanSegmentThickness(wall, segment);
      if (thickness > 0) {
        const polygon = rect(frame, 0, frame.length, thickness / 2);
        entry.polygons.push(polygon);
        clipsByPolygon.set(polygon, network.roomsForSegment(wall, segment));
        axesByPolygon.set(polygon, [frame]);
      } else
        entry.schematicSegments.push({
          id: segment.id,
          points: [pixels(segment.start), pixels(segment.end)],
          thicknessUnknown: true,
        });
      for (const kind of ['doors', 'windows'])
        for (const opening of wall[kind].filter((item) => item.segmentId === segment.id))
          openings.push({
            id: opening.id,
            wallId: wall.id,
            segmentId: segment.id,
            kind,
            thickness,
            points: [at(frame, opening.offset), at(frame, opening.offset + opening.width)],
            polygon:
              thickness > 0
                ? rect(frame, opening.offset, opening.offset + opening.width, thickness / 2)
                : [],
          });
    }
  }

  // Bound axes terminate at the room's corner projections. Fill the exterior corner up to
  // the two outer faces; concave corners are trimmed against their room interiors below.
  for (const room of floor.rooms) {
    const side = Math.sign(polygonArea(room.vertices));
    const edges = room.vertices.map((p, i) =>
      segmentFrame(p, room.vertices[(i + 1) % room.vertices.length])
    );
    const bound = (index, atEnd) => {
      const edge = room.edges.find((e) => e.startId === room.vertices[index].id);
      for (const face of room.faces.filter((f) => !f.freePath))
        for (const binding of face.bindings)
          if (
            binding.edgeId === edge.id &&
            Math.abs(binding.roomInterval[atEnd ? 1 : 0] - (atEnd ? edges[index].length : 0)) < 1e-6
          ) {
            const wall = floor.walls.find((w) => w.id === face.wallId);
            return {
              wall,
              axis: segmentFrame(
                wall.segments.find((s) => s.id === binding.segmentId).start,
                wall.segments.find((s) => s.id === binding.segmentId).end
              ),
              thickness: buildingPlanSegmentThickness(
                wall,
                wall.segments.find((s) => s.id === binding.segmentId)
              ),
            };
          }
      return null;
    };
    for (let i = 0; !boundaryOnly && i < edges.length; i++) {
      const previous = (i + edges.length - 1) % edges.length;
      const a = bound(previous, true),
        b = bound(i, false);
      addWallCorner(walls, edges[previous], edges[i], room.vertices[i], a, b, side, (polygon) => {
        const joint = a?.axis && b?.axis && junctionIntersection(a.axis, b.axis);
        clipsByPolygon.set(polygon, [
          ...new Set([room.id, ...(joint ? network.roomsAtJunction(a, b, joint) : [])]),
        ]);
        axesByPolygon.set(polygon, [a?.axis, b?.axis].filter(Boolean));
      });
    }
    // Explicit partition cuts connect their derived return to the same captured chain.
    const partitions = boundaryOnly
      ? []
      : room.faces.filter(
          (face) => face.freePath?.length === 2 && face.lineage?.editingOriginFaceId
        );
    const construction = (face, binding) => {
      const wall = floor.walls.find((wall) => wall.id === face.wallId);
      return {
        wall,
        thickness: buildingPlanSegmentThickness(
          wall,
          wall.segments.find((segment) => segment.id === binding.segmentId)
        ),
      };
    };
    for (const incoming of partitions) {
      const point = incoming.freePath[1];
      if (!point.editingCutId) continue;
      for (const outgoing of partitions.filter(
        (face) =>
          face !== incoming &&
          face.lineage.editingOriginFaceId === incoming.lineage.editingOriginFaceId &&
          face.freePath[0].editingCutId === point.editingCutId &&
          Math.hypot(face.freePath[0].x - point.x, face.freePath[0].y - point.y) <= 1e-6
      )) {
        const incomingFrame = segmentFrame(...incoming.freePath),
          outgoingFrame = segmentFrame(...outgoing.freePath);
        const a = incoming.bindings.find(
          (binding) => Math.abs(binding.roomInterval[1] - incomingFrame.length) <= 1e-6
        );
        const b = outgoing.bindings.find((binding) => Math.abs(binding.roomInterval[0]) <= 1e-6);
        if (!a || !b || a.side * a.direction !== b.side * b.direction) continue;
        addWallCorner(
          walls,
          incomingFrame,
          outgoingFrame,
          point,
          construction(incoming, a),
          construction(outgoing, b),
          a.side * a.direction
        );
      }
    }
  }
  const roomTriangles = new Map(floor.rooms.map((r) => [r.id, triangles(r.vertices)]));
  for (const entry of walls.values()) {
    entry.polygons = entry.polygons.flatMap((polygon) => {
      const clips = (clipsByPolygon.get(polygon) || []).flatMap((id) => roomTriangles.get(id));
      const axes = axesByPolygon.get(polygon) || [];
      clips.push(
        ...openings
          .filter(
            (o) =>
              o.polygon.length &&
              (axes.length
                ? axes.some((axis) => network.collinear(axis, segmentFrame(...o.points)))
                : o.wallId === entry.id)
          )
          .map((o) => o.polygon)
      );
      let pieces = [polygon];
      for (const clip of clips) pieces = pieces.flatMap((piece) => subtractConvex(piece, clip));
      return pieces;
    });
    entry.polygons = entry.polygons.map((polygon) =>
      (polygonArea(polygon) < 0 ? [...polygon].reverse() : polygon).map(pixels)
    );
  }

  return {
    wallFootprints: [...walls.values()],
    physicalOpenings: openings.map((o) => ({
      ...o,
      points: o.points.map(pixels),
      polygon: o.polygon.map(pixels),
    })),
  };
}

/** A face-oriented axis is used by opening gestures so row-relative ratios remain unchanged. */
export function buildingPlanFaceAxes(wall, portions, pixels) {
  return portions.flatMap((part, index) => {
    const segment = wall.segments.find((s) => s.id === part.segmentId);
    const frame = segmentFrame(segment.start, segment.end);
    const start = at(frame, part.interval[part.direction > 0 ? 0 : 1]);
    const end = at(frame, part.interval[part.direction > 0 ? 1 : 0]);
    return index ? [pixels(end)] : [pixels(start), pixels(end)];
  });
}

/** Perimeter bands cannot occupy a different room where no shared axis bounds them.
 * This is a metric clearance constraint, not a blanket renderer clip. Deliberately authored
 * internal partitions are excluded. Stationary lines and intentional cuts can make a drag
 * unsatisfiable even when the two clear-room polygons merely touch rather than overlap.
 */
export function buildingPlanBoundaryClearanceIssues(floor) {
  const { wallFootprints } = buildingPlanFootprints(floor, 1, { boundaryOnly: true });
  for (const wall of wallFootprints)
    for (const room of floor.rooms) {
      const overlap = wall.polygons.some((points) => {
        const polygon = points.filter(
          (p, i) => distance(p, points[(i + points.length - 1) % points.length]) > 1e-6
        );
        return polygon.length >= 3 && polygonsOverlap(polygon, room.vertices);
      });
      if (overlap)
        return [
          planIssue(
            'wall_clearance_conflict',
            `The wall would enter Room ${floor.rooms.indexOf(room) + 1}. Move rejected; try a smaller drag or edit the adjoining portion.`,
            { type: 'room', id: room.id },
            { wallId: wall.id }
          ),
        ];
    }
  return [];
}
