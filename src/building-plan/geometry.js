/** Metric, renderer-independent geometry. Tolerances are in metres. */
export const GEOMETRY_EPSILON = 1e-6;

export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const multiply = (a, k) => ({ x: a.x * k, y: a.y * k });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const length = (a) => Math.hypot(a.x, a.y);
export const distance = (a, b) => length(subtract(b, a));
export const near = (a, b, tolerance = GEOMETRY_EPSILON) => Math.abs(a - b) <= tolerance;
export const samePoint = (a, b) => distance(a, b) <= GEOMETRY_EPSILON;
export const isPoint = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
export const cleanPoint = (p) => ({
  ...p,
  x: Math.round(p.x * 1e9) / 1e9,
  y: Math.round(p.y * 1e9) / 1e9,
});

export function segmentFrame(start, end) {
  const delta = subtract(end, start);
  const size = length(delta);
  if (size <= GEOMETRY_EPSILON) throw new Error('A segment requires distinct endpoints.');
  const tangent = multiply(delta, 1 / size);
  return { start, end, length: size, tangent, normal: { x: -tangent.y, y: tangent.x } };
}

export function at(frame, along, offset = 0) {
  return cleanPoint(
    add(frame.start, add(multiply(frame.tangent, along), multiply(frame.normal, offset)))
  );
}

export function project(frame, point) {
  const delta = subtract(point, frame.start);
  return { along: dot(delta, frame.tangent), offset: dot(delta, frame.normal) };
}

export function polygonArea(vertices) {
  return (
    vertices.reduce(
      (area, p, index) => area + cross(p, vertices[(index + 1) % vertices.length]),
      0
    ) / 2
  );
}

export function polygonEdges(room) {
  return room.vertices.map((start, index) => {
    const end = room.vertices[(index + 1) % room.vertices.length];
    const identity = room.edges?.find((edge) => edge.startId === start.id && edge.endId === end.id);
    return { ...identity, start, end, ...segmentFrame(start, end) };
  });
}

export function pointOnSegment(p, a, b) {
  if (distance(a, b) <= GEOMETRY_EPSILON) return samePoint(p, a);
  const frame = segmentFrame(a, b);
  const projection = project(frame, p);
  return (
    Math.abs(projection.offset) <= GEOMETRY_EPSILON &&
    projection.along >= -GEOMETRY_EPSILON &&
    projection.along <= frame.length + GEOMETRY_EPSILON
  );
}

export function segmentsIntersect(a, b, c, d) {
  const ab = subtract(b, a);
  const cd = subtract(d, c);
  const denominator = cross(ab, cd);
  if (Math.abs(denominator) <= GEOMETRY_EPSILON) {
    return (
      [a, b].some((p) => pointOnSegment(p, c, d)) || [c, d].some((p) => pointOnSegment(p, a, b))
    );
  }
  const ac = subtract(c, a);
  const t = cross(ac, cd) / denominator;
  const u = cross(ac, ab) / denominator;
  return (
    t >= -GEOMETRY_EPSILON &&
    t <= 1 + GEOMETRY_EPSILON &&
    u >= -GEOMETRY_EPSILON &&
    u <= 1 + GEOMETRY_EPSILON
  );
}

export function polygonIssue(vertices) {
  if (!Array.isArray(vertices) || vertices.length < 3 || vertices.some((p) => !isPoint(p))) {
    return 'A room requires at least three finite metric vertices.';
  }
  if (Math.abs(polygonArea(vertices)) <= GEOMETRY_EPSILON) return 'The room has collapsed.';
  for (let i = 0; i < vertices.length; i++) {
    const next = (i + 1) % vertices.length;
    if (samePoint(vertices[i], vertices[next])) return 'A room edge has collapsed.';
    for (let j = i + 1; j < vertices.length; j++) {
      if (j === next || (i === 0 && j === vertices.length - 1)) continue;
      if (
        segmentsIntersect(
          vertices[i],
          vertices[next],
          vertices[j],
          vertices[(j + 1) % vertices.length]
        )
      ) {
        return 'The room boundary intersects itself.';
      }
    }
  }
  return null;
}

export function pointInPolygon(point, vertices, includeBoundary = true) {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[j];
    const b = vertices[i];
    if (pointOnSegment(point, a, b)) return includeBoundary;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

export function polygonsOverlap(a, b) {
  if (a.some((p) => pointInPolygon(p, b, false)) || b.some((p) => pointInPolygon(p, a, false)))
    return true;
  // Interior samples catch coincident outlines and collinear rectangle overlaps.
  for (const vertices of [a, b]) {
    const sign = Math.sign(polygonArea(vertices));
    for (let i = 0; i < vertices.length; i++) {
      const frame = segmentFrame(vertices[i], vertices[(i + 1) % vertices.length]);
      const p = at(frame, frame.length / 2, sign * GEOMETRY_EPSILON * 4);
      if (pointInPolygon(p, a, false) && pointInPolygon(p, b, false)) return true;
    }
  }
  return false;
}

export function assignRoomEdges(room, createId, previousEdges = room.edges || []) {
  room.edges = room.vertices.map((p, index) => {
    const end = room.vertices[(index + 1) % room.vertices.length];
    return (
      previousEdges.find((edge) => edge.startId === p.id && edge.endId === end.id) || {
        id: createId(),
        startId: p.id,
        endId: end.id,
      }
    );
  });
}

/** Shift just an interval of an edge; partial intervals create a local jog. */
export function shiftRoomEdge(room, edgeId, interval, delta, createId) {
  const edges = polygonEdges(room);
  const index = edges.findIndex((edge) => edge.id === edgeId);
  if (index < 0) throw new Error('The room edge no longer exists.');
  const edge = edges[index];
  let [from, to] = [...interval].sort((a, b) => a - b);
  if (
    from < -GEOMETRY_EPSILON ||
    to > edge.length + GEOMETRY_EPSILON ||
    to - from <= GEOMETRY_EPSILON
  )
    throw new Error('The edited extent is outside its room edge.');
  from = Math.max(0, from);
  to = Math.min(edge.length, to);
  const previous = room.edges;
  const adjacentStart = edges[(index + edges.length - 1) % edges.length];
  const adjacentEnd = edges[(index + 1) % edges.length];
  const holdStart =
    from <= GEOMETRY_EPSILON &&
    edge.start.editingCutId &&
    near(dot(adjacentStart.tangent, edge.tangent), 1);
  const holdEnd =
    to >= edge.length - GEOMETRY_EPSILON &&
    edge.end.editingCutId &&
    near(dot(adjacentEnd.tangent, edge.tangent), 1);
  const start =
    from <= GEOMETRY_EPSILON && !holdStart
      ? cleanPoint({ ...edge.start, ...add(edge.start, delta) })
      : edge.start;
  const end =
    to >= edge.length - GEOMETRY_EPSILON && !holdEnd
      ? cleanPoint({ ...edge.end, ...add(edge.end, delta) })
      : edge.end;
  const inserted = [];
  if (holdStart)
    inserted.push(cleanPoint({ ...edge.start, ...add(edge.start, delta), id: createId() }));
  if (from > GEOMETRY_EPSILON) {
    inserted.push(
      { ...at(edge, from), id: createId() },
      { ...cleanPoint(add(at(edge, from), delta)), id: createId() }
    );
  }
  if (to < edge.length - GEOMETRY_EPSILON) {
    inserted.push(
      { ...cleanPoint(add(at(edge, to), delta)), id: createId() },
      { ...at(edge, to), id: createId() }
    );
  }
  if (holdEnd) inserted.push(cleanPoint({ ...edge.end, ...add(edge.end, delta), id: createId() }));
  const vertices = room.vertices.map((p) =>
    p.id === edge.start.id ? start : p.id === edge.end.id ? end : p
  );
  vertices.splice(index + 1, 0, ...inserted);
  room.vertices = vertices;
  assignRoomEdges(room, createId, previous);
}

export function roomBounds(room) {
  const xs = room.vertices.map((p) => p.x);
  const ys = room.vertices.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** A canvas-space input conversion shared by browser and native adapters. */
export function buildingPlanPointFromViewport(point, viewport) {
  const scale = viewport.scale;
  if (!Number.isFinite(scale) || scale <= 0 || !isPoint(point))
    throw new TypeError('A finite point and positive viewport scale are required.');
  return cleanPoint({
    x: (point.x - (viewport.x || 0)) / scale,
    y: (point.y - (viewport.y || 0)) / scale,
  });
}
