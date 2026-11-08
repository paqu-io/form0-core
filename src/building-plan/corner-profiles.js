import {
  GEOMETRY_EPSILON as EPS,
  add,
  at,
  cleanPoint,
  cross,
  distance,
  dot,
  multiply,
  pointInPolygon,
  polygonArea,
  polygonEdges,
  polygonsOverlap,
  project,
  segmentFrame,
  subtract,
} from './geometry.js';

/** The material outside a convex clear-room corner, bounded by its two outer faces. */
export function wallCornerPolygon(incoming, outgoing, point, a, b, side) {
  if (!(a > 0 && b > 0)) return null;
  const denominator = cross(incoming.tangent, outgoing.tangent);
  if (denominator * side <= EPS) return null;
  const qa = add(point, multiply(incoming.normal, -side * a));
  const qb = add(point, multiply(outgoing.normal, -side * b));
  const along = cross(subtract(qb, qa), outgoing.tangent) / denominator;
  const intersection = add(qa, multiply(incoming.tangent, along));
  return distance(intersection, point) <= 4 * Math.max(a, b)
    ? [point, qa, intersection, qb].map(cleanPoint)
    : [point, qa, qb].map(cleanPoint);
}

function crossingStations(edge, clip) {
  const stations = [0, edge.length];
  for (const other of clip) {
    const denominator = cross(edge.tangent, other.tangent);
    if (Math.abs(denominator) <= EPS) {
      if (Math.abs(project(edge, other.start).offset) <= EPS)
        stations.push(project(edge, other.start).along, project(edge, other.end).along);
    } else {
      const along = cross(subtract(other.start, edge.start), other.tangent) / denominator;
      const point = at(edge, along),
        onOther = project(other, point).along;
      if (onOther >= -EPS && onOther <= other.length + EPS) stations.push(along);
    }
  }
  return stations
    .filter((value) => value >= -EPS && value <= edge.length + EPS)
    .map((value) => Math.max(0, Math.min(edge.length, value)))
    .sort((a, b) => a - b)
    .filter((value, index, all) => !index || value - all[index - 1] > EPS);
}

function completionConflict() {
  throw Object.assign(
    new Error(
      'This corner cannot be completed without removing a deliberate cut or dividing a room. Adjust the adjoining geometry first.'
    ),
    {
      issues: [
        {
          code: 'corner_completion_conflict',
          message:
            'This corner cannot be completed while preserving the room and its deliberate cuts.',
        },
      ],
    }
  );
}

/** Subtract one local convex cap, retaining original boundary/row identities.
 * Split both boundaries at their intersections and keep the directed arcs that bound
 * remaining clear space. A disconnected result is a geometry conflict, never a new room.
 */
function subtractCap(room, polygon, sources, createId) {
  const original = polygonEdges(room);
  const cap = polygon.map((start, i) => segmentFrame(start, polygon[(i + 1) % polygon.length]));
  const remaining = (p) =>
    pointInPolygon(p, room.vertices, false) && !pointInPolygon(p, polygon, false);
  const pieces = [];
  for (const [edges, clips, isRoom] of [
    [original, cap, true],
    [cap, original, false],
  ])
    for (const [index, edge] of edges.entries()) {
      const stations = crossingStations(edge, clips);
      for (let i = 1; i < stations.length; i++) {
        let start = at(edge, stations[i - 1]),
          end = at(edge, stations[i]);
        const middle = (stations[i - 1] + stations[i]) / 2;
        const left = remaining(at(edge, middle, EPS * 8)),
          right = remaining(at(edge, middle, -EPS * 8));
        if (left === right) continue;
        if (!left) [start, end] = [end, start];
        if (
          pieces.some(
            (piece) => distance(piece.start, start) <= EPS && distance(piece.end, end) <= EPS
          )
        )
          continue;
        pieces.push({
          start,
          end,
          source: isRoom ? edge : null,
          profile: isRoom ? edge.profile : sources[index],
        });
      }
    }
  if (!pieces.length) completionConflict();
  const ordered = [pieces.shift()];
  while (pieces.length) {
    const index = pieces.findIndex((piece) => distance(piece.start, ordered.at(-1).end) <= EPS);
    if (index < 0) completionConflict();
    ordered.push(...pieces.splice(index, 1));
  }
  if (distance(ordered.at(-1).end, ordered[0].start) > EPS) completionConflict();
  if (
    Math.abs(
      Math.abs(polygonArea(ordered.map((piece) => piece.start))) -
        Math.abs(polygonArea(room.vertices))
    ) <=
    EPS * EPS
  )
    return false;
  if (polygonArea(room.vertices) < 0) {
    ordered.reverse();
    for (const piece of ordered) [piece.start, piece.end] = [piece.end, piece.start];
  }
  // Keep the room's cyclic origin as well as its winding and surviving identities.
  const origin = room.vertices.find((point) =>
    ordered.some((piece) => distance(piece.start, point) <= EPS)
  );
  if (!origin) completionConflict();
  const first = ordered.findIndex((piece) => distance(piece.start, origin) <= EPS);
  ordered.push(...ordered.splice(0, first));
  const vertices = ordered.map((piece) => {
    const original = room.vertices.find((point) => distance(point, piece.start) <= EPS);
    return original
      ? { ...original }
      : { ...cleanPoint(piece.start), id: createId(), physicalBoundaryId: createId() };
  });
  if (
    room.vertices.some(
      (point) => point.editingCutId && !vertices.some((other) => other.id === point.id)
    )
  )
    completionConflict();
  const mapping = new Map(),
    used = new Set();
  const edges = ordered.map((piece, index) => {
    const id = piece.source && !used.has(piece.source.id) ? piece.source.id : createId();
    used.add(id);
    if (piece.source) {
      const next = mapping.get(piece.source.id) || [];
      next.push(id);
      mapping.set(piece.source.id, next);
    }
    const edge = {
      id,
      startId: vertices[index].id,
      endId: vertices[(index + 1) % vertices.length].id,
    };
    if (piece.profile) edge.profile = { ...piece.profile };
    return edge;
  });
  room.vertices = vertices;
  room.edges = edges;
  for (const face of room.faces)
    if (face.edgeIds) face.edgeIds = face.edgeIds.flatMap((id) => mapping.get(id) || []);
  return true;
}

/** Complete material corners of changed walls before the ordinary boundary reconciliation. */
export function completeThicknessCorners(floor, before, wallIds, createId) {
  const changed = new Set();
  for (const room of floor.rooms) {
    const edges = polygonEdges(room),
      sign = Math.sign(polygonArea(room.vertices));
    const old = before.rooms.find((other) => other.id === room.id);
    const oldEdges = old ? polygonEdges(old) : [];
    const bound = (edge, end) => {
      for (const face of room.faces.filter(
        (face) => !face.freePath && face.edgeIds.includes(edge.id)
      )) {
        const wall = floor.walls.find((wall) => wall.id === face.wallId);
        if (!wall) continue;
        for (const span of wall.segments) {
          const frame = segmentFrame(span.start, span.end);
          const point = project(frame, end ? edge.end : edge.start);
          if (
            Math.abs(Math.abs(point.offset) - wall.properties.wall_thickness_m / 2) <= EPS &&
            Math.abs(dot(frame.tangent, edge.tangent)) >= 1 - EPS &&
            point.along >= -EPS &&
            point.along <= frame.length + EPS
          )
            return { wall, binding: { side: Math.sign(point.offset) }, edge, span };
        }
      }
      return null;
    };
    for (let i = 0; i < edges.length; i++) {
      const incoming = edges[(i + edges.length - 1) % edges.length],
        outgoing = edges[i];
      const oldIndex = old?.vertices.findIndex((point) => point.id === room.vertices[i].id) ?? -1;
      if (
        oldIndex < 0 ||
        cross(
          oldEdges[(oldIndex + oldEdges.length - 1) % oldEdges.length].tangent,
          oldEdges[oldIndex].tangent
        ) *
          sign <=
          EPS
      )
        continue;
      const a = bound(incoming, true),
        b = bound(outgoing, false);
      if (!a || !b || (!wallIds.has(a.wall.id) && !wallIds.has(b.wall.id))) continue;
      if (
        a.span.junction ||
        b.span.junction ||
        a.wall.lineage?.profileSource ||
        b.wall.lineage?.profileSource
      )
        continue;
      const polygon = wallCornerPolygon(
        incoming,
        outgoing,
        room.vertices[i],
        a.wall.properties.wall_thickness_m,
        b.wall.properties.wall_thickness_m,
        sign
      );
      if (!polygon) continue;
      const sources = polygon.map((point, index) => {
        const frame = segmentFrame(point, polygon[(index + 1) % polygon.length]);
        const owner =
          Math.abs(dot(frame.tangent, incoming.tangent)) >=
          Math.abs(dot(frame.tangent, outgoing.tangent))
            ? a
            : b;
        return { wallId: owner.wall.id, sideSign: -owner.binding.side };
      });
      for (const other of floor.rooms) {
        if (
          other === room ||
          !other.faces.some((face) => face.wallId === a.wall.id || face.wallId === b.wall.id)
        )
          continue;
        const hasOverlap = polygonsOverlap(polygon, other.vertices);
        if (hasOverlap && subtractCap(other, polygon, sources, createId)) changed.add(other.id);
      }
    }
  }
  return changed;
}
