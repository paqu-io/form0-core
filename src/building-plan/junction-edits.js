import {
  GEOMETRY_EPSILON as EPS,
  add,
  multiply,
  at,
  assignRoomEdges,
  cleanPoint,
  distance,
  dot,
  near,
  polygonArea,
  polygonEdges,
  project,
  segmentFrame,
} from './geometry.js';
import { buildingPlanSegmentThickness, findRoom, findWall, planIssue } from './model.js';

function reject(code, message, subject = null) {
  throw Object.assign(new Error(message), { issues: [planIssue(code, message, subject)] });
}
function conflict() {
  reject(
    'corner_constraint_conflict',
    'These shared portions cannot meet while preserving the adjoining wall. Split a shorter portion or move a different corner.'
  );
}

/** Supporting-line intersection; no axis-specific or endpoint-clamping rule. */
export function junctionIntersection(a, b) {
  const cross = a.tangent.x * b.tangent.y - a.tangent.y * b.tangent.x;
  if (Math.abs(cross) <= EPS) return null;
  const dx = b.start.x - a.start.x,
    dy = b.start.y - a.start.y;
  return at(a, (dx * b.tangent.y - dy * b.tangent.x) / cross);
}

/** Capture the active room's old/new lines and actual construction thicknesses once per edit. */
export function buildingPlanJunctionReferences(floor, before, roomId) {
  const room = floor.rooms.find((r) => r.id === roomId),
    old = before.rooms.find((r) => r.id === roomId);
  if (!room || !old) return [];
  const edges = polygonEdges(room);
  return polygonEdges(old).flatMap((edge) => {
    const next = edges.find((e) => e.id === edge.id);
    if (!next) return [];
    const face = old.faces.find((f) => f.edgeIds?.includes(edge.id));
    const wall = face && findWall(before, face.wallId);
    const bindings = face?.bindings.filter((b) => b.edgeId === edge.id) || [];
    const value = (b) =>
      buildingPlanSegmentThickness(
        wall,
        wall.segments.find((s) => s.id === b.segmentId)
      );
    const thickness = bindings.map(value);
    const endThickness = (along) =>
      bindings
        .filter((b) => b.roomInterval[0] <= along + EPS && b.roomInterval[1] >= along - EPS)
        .map(value)[0];
    return [
      {
        old: edge,
        edge: next,
        sign: Math.sign(polygonArea(room.vertices)),
        startThickness: endThickness(0),
        endThickness: endThickness(edge.length),
        thickness: thickness?.every((t) => near(t, thickness[0])) ? thickness[0] : null,
      },
    ];
  });
}

/** Maximum along-line reach of the two incident material bands, independent of world axes. */
export function buildingPlanJunctionAllowance(floor, room, edge, vertex, thickness) {
  const adjacent = polygonEdges(room).find(
    (e) => e.id !== edge.id && (e.start.id === vertex.id || e.end.id === vertex.id)
  );
  if (!adjacent) return 0;
  const sine = Math.abs(dot(edge.normal, adjacent.tangent));
  if (sine <= EPS) return 0;
  const face = room.faces.find((f) => f.edgeIds?.includes(adjacent.id));
  const along = adjacent.start.id === vertex.id ? 0 : adjacent.length;
  const binding = face?.bindings.find(
    (b) =>
      b.edgeId === adjacent.id &&
      b.roomInterval[0] <= along + EPS &&
      b.roomInterval[1] >= along - EPS
  );
  const wall = face && findWall(floor, face.wallId);
  const other =
    binding &&
    buildingPlanSegmentThickness(
      wall,
      wall.segments.find((s) => s.id === binding.segmentId)
    );
  return other > EPS
    ? (other + thickness * Math.abs(dot(edge.tangent, adjacent.tangent))) / sine
    : 0;
}

function connection(moving, stationary, reference, end, sign) {
  if (!(reference.thickness > EPS)) return null;
  for (const opposite of [true, false]) {
    const offset = opposite ? -reference.sign * reference.thickness : 0;
    const line = segmentFrame(
      at(reference.edge, 0, offset),
      at(reference.edge, reference.edge.length, offset)
    );
    const point = junctionIntersection(moving, line),
      fixed = junctionIntersection(stationary, line);
    if (!point || !fixed) continue;
    if (distance(point, fixed) > EPS) {
      const direction = segmentFrame(end ? point : fixed, end ? fixed : point).tangent;
      const sameSide = sign * dot(direction, reference.edge.tangent) * reference.sign > 0;
      if (sameSide === opposite) continue;
    }
    return { point, fixed };
  }
  // At a rotating junction the two offset lines can meet inside the wall band.
  // Keep their true intersection instead of inserting a connector that folds back.
  const point = junctionIntersection(moving, stationary);
  if (point) {
    const offset = project(reference.edge, point).offset;
    const opposite = -reference.sign * reference.thickness;
    if (offset >= Math.min(0, opposite) - EPS && offset <= Math.max(0, opposite) + EPS)
      return { point, fixed: point };
  }
  return null;
}

function prepareConnections(room, edits, references) {
  if (!references.length) return;
  const edges = polygonEdges(room),
    sign = Math.sign(polygonArea(room.vertices));
  for (const edit of [...edits]) {
    if (distance(edit.start, edit.end) <= EPS) continue;
    const edge = edges.find((e) => e.id === edit.edgeId);
    const active = references.find((r) => r.old.id === edit.activeEdgeId);
    if (!active) continue;
    for (const end of [0, 1]) {
      let partial = !near(edit.interval[end], end ? edge.length : 0);
      const oldPoint = at(edge, edit.interval[end]);
      const corner = project(active.old, oldPoint).along;
      const gap = Math.max(active.thickness || 0, EPS) * 2;
      const vertex =
        Math.abs(corner) <= gap
          ? active.old.start
          : Math.abs(corner - active.old.length) <= gap
            ? active.old.end
            : null;
      const candidate =
        vertex &&
        references.find(
          (r) => r !== active && (r.old.start.id === vertex.id || r.old.end.id === vertex.id)
        );
      if (!candidate) continue;
      const reference = {
        ...candidate,
        thickness:
          candidate.old.start.id === vertex.id ? candidate.startThickness : candidate.endThickness,
      };
      if (!(reference.thickness > EPS)) {
        const message =
          'Set a positive thickness for the adjoining wall before connecting this return.';
        throw Object.assign(new Error(message), {
          issues: [planIssue('unknown_wall_thickness', message)],
        });
      }
      let stationary = edge,
        adjacent = null;
      if (partial && (end ? edge.length - edit.interval[end] : edit.interval[end]) <= gap) {
        const id = end ? edge.end.id : edge.start.id;
        const neighbour = edges.find(
          (e) => e.id !== edge.id && (e.start.id === id || e.end.id === id)
        );
        if (
          neighbour &&
          Math.abs(dot(neighbour.tangent, reference.old.tangent)) >= 1 - EPS &&
          (near(project(reference.old, neighbour.start).offset, 0) ||
            near(
              project(reference.old, neighbour.start).offset,
              -reference.sign * reference.thickness
            ))
        ) {
          partial = false;
          edit.interval[end] = end ? edge.length : 0;
        }
      }
      if (!partial) {
        const id = end ? edge.end.id : edge.start.id;
        adjacent = edges.find((e) => e.id !== edge.id && (e.start.id === id || e.end.id === id));
        if (!adjacent) continue;
        const offset = project(reference.old, adjacent.start).offset;
        if (
          Math.abs(dot(adjacent.tangent, reference.old.tangent)) >= 1 - EPS &&
          (near(offset, 0) || near(offset, -reference.sign * reference.thickness))
        ) {
          const outer = end ? adjacent.end.id : adjacent.start.id;
          stationary = edges.find(
            (e) => e.id !== adjacent.id && (e.start.id === outer || e.end.id === outer)
          );
        } else {
          stationary = adjacent;
          adjacent = null;
        }
      }
      if (!stationary) continue;
      const junction = connection(
        segmentFrame(edit.start, edit.end),
        stationary,
        reference,
        end,
        sign
      );
      if (!junction) continue;
      edit[end ? 'end' : 'start'] = junction.point;
      if (partial) {
        edit.interval[end] = Math.max(
          0,
          Math.min(edge.length, project(edge, junction.fixed).along)
        );
      } else if (adjacent) {
        let replacement = edits.find((e) => e.edgeId === adjacent.id);
        if (!replacement) {
          replacement = { edgeId: adjacent.id };
          edits.push(replacement);
        }
        Object.assign(replacement, {
          interval: [0, adjacent.length],
          start: end ? junction.point : junction.fixed,
          end: end ? junction.fixed : junction.point,
        });
      } else if (distance(junction.point, junction.fixed) > EPS) {
        edit[end ? 'joinEnd' : 'joinStart'] = junction;
      }
    }
  }
}

/**
 * Reconstruct a local boundary from changed lines and bound extents. Both wall-body
 * and corner edits cross this seam; physical ownership and history remain with callers.
 * Edits are updated to their resolved endpoints for physical-host extent reconciliation.
 */
export function reshapeBuildingPlanBoundary(room, edits, createId, references = []) {
  const edges = polygonEdges(room);
  prepareConnections(room, edits, references);
  const targets = new Map(),
    held = new Map(),
    fixed = new Map();
  for (const edit of edits) {
    const edge = edges.find((e) => e.id === edit.edgeId);
    for (const end of [0, 1])
      if (near(edit.interval[end], end ? edge.length : 0)) {
        const vertex = end ? edge.end : edge.start;
        const join = edit[end ? 'joinEnd' : 'joinStart'];
        if (join) {
          fixed.set(vertex.id, join.fixed);
          continue;
        }
        const list = targets.get(vertex.id) || [];
        list.push({
          start: end ? edit.end : edit.start,
          end: end ? edit.start : edit.end,
          edgeId: edge.id,
        });
        targets.set(vertex.id, list);
      }
  }
  const vertices = new Map(room.vertices.map((p) => [p.id, { ...p }]));
  for (const [id, point] of fixed) Object.assign(vertices.get(id), cleanPoint(point));
  for (const [id, lines] of targets) {
    const collapsed = lines.find((line) => distance(line.start, line.end) <= EPS);
    let point = collapsed?.start || lines[0].start;
    if (!collapsed) {
      const moving = segmentFrame(lines[0].start, lines[0].end);
      const stationary =
        lines.length === 1 &&
        edges.find((e) => e.id !== lines[0].edgeId && (e.start.id === id || e.end.id === id));
      if (stationary) {
        point = junctionIntersection(moving, stationary);
        if (!point && Math.abs(project(stationary, lines[0].start).offset) <= EPS)
          point = at(stationary, project(stationary, lines[0].start).along);
        if (!point && vertices.get(id).editingCutId) {
          held.set(id, lines[0]);
          continue;
        }
      }
      if (lines.length > 1 && distance(point, lines[1].start) > EPS)
        point = junctionIntersection(moving, segmentFrame(lines[1].start, lines[1].end));
    }
    if (
      !point ||
      lines.some(
        (line) =>
          distance(line.start, line.end) > EPS &&
          Math.abs(project(segmentFrame(line.start, line.end), point).offset) > EPS
      )
    )
      conflict();
    Object.assign(vertices.get(id), cleanPoint(point));
  }
  const next = [],
    replacements = new Map();
  for (const edge of edges) {
    const path = [vertices.get(edge.start.id)];
    const push = (point) => {
      if (distance(path.at(-1), point) > EPS) path.push({ ...cleanPoint(point), id: createId() });
    };
    if (held.get(edge.start.id)?.edgeId === edge.id)
      push({ ...edge.start, ...held.get(edge.start.id).start });
    for (const edit of edits
      .filter((e) => e.edgeId === edge.id)
      .sort((a, b) => a.interval[0] - b.interval[0])) {
      if (edit.joinStart) push(edit.joinStart.point);
      if (edit.interval[0] > EPS) {
        push(at(edge, edit.interval[0]));
        push(edit.start);
      }
      if (edit.interval[1] < edge.length - EPS) {
        push(edit.end);
        push(at(edge, edit.interval[1]));
      }
      if (edit.joinEnd) push(edit.joinEnd.point);
      if (near(edit.interval[0], 0) && !held.has(edge.start.id) && !edit.joinStart)
        edit.start = vertices.get(edge.start.id);
      if (near(edit.interval[1], edge.length) && !held.has(edge.end.id) && !edit.joinEnd)
        edit.end = vertices.get(edge.end.id);
    }
    if (held.get(edge.end.id)?.edgeId === edge.id)
      push({ ...edge.end, ...held.get(edge.end.id).start });
    replacements.set(edge.id, [edge.start.id, edge.end.id]);
    next.push(...path);
  }
  const previous = room.edges;
  room.vertices = next;
  assignRoomEdges(room, createId, previous);
  for (const face of room.faces)
    if (!face.freePath)
      face.edgeIds = face.edgeIds.flatMap((id) => {
        const [start, end] = replacements.get(id) || [];
        if (!start) return [id];
        const index = room.edges.findIndex((e) => e.startId === start),
          ids = [];
        for (let n = 0; n < room.edges.length; n++) {
          const edge = room.edges[(index + n) % room.edges.length];
          ids.push(edge.id);
          if (edge.endId === end) break;
        }
        return ids;
      });
  return room.edges.filter((e) => !previous.some((old) => old.id === e.id)).map((e) => e.id);
}

/** Translate one selected supporting line; neighbouring directions are constraints. */
export function shiftBuildingPlanBoundary(room, edgeId, interval, delta, createId) {
  const edge = polygonEdges(room).find((e) => e.id === edgeId);
  if (
    !edge ||
    interval[0] < -EPS ||
    interval[1] > edge.length + EPS ||
    interval[1] - interval[0] <= EPS
  )
    throw new Error('The edited extent is outside its room edge.');
  const point = (along) => {
    const p = at(edge, along);
    return cleanPoint({ x: p.x + delta.x, y: p.y + delta.y });
  };
  return reshapeBuildingPlanBoundary(
    room,
    [{ edgeId, interval, start: point(interval[0]), end: point(interval[1]) }],
    createId
  );
}

/** New returns alongside the active room use its fixed face and one wall-thickness gap. */
export function alignBuildingPlanThicknessReturns(floor, changedEdges, activeRoomId, before) {
  const active = floor.rooms.find((room) => room.id === activeRoomId);
  const aligned = new Set();
  if (!active) return aligned;
  for (const change of changedEdges.filter((entry) => entry.roomId !== activeRoomId)) {
    const room = findRoom(floor, change.roomId);
    for (const edgeId of change.edgeIds) {
      const edge = polygonEdges(room).find((entry) => entry.id === edgeId);
      if (!edge) continue;
      for (const reference of polygonEdges(active)) {
        if (
          dot(edge.tangent, reference.tangent) > -1 + EPS ||
          !near(project(reference, edge.start).offset, 0)
        )
          continue;
        const span = [
          project(reference, edge.start).along,
          project(reference, edge.end).along,
        ].sort((a, b) => a - b);
        if (Math.min(reference.length, span[1]) - Math.max(0, span[0]) < -EPS) continue;
        const face = active.faces.find((face) => face.edgeIds?.includes(reference.id));
        if (!face) continue;
        const wall = findWall(floor, face.wallId);
        const oldRoom = before.rooms.find((room) => room.id === activeRoomId);
        const oldEdge = oldRoom && polygonEdges(oldRoom).find((edge) => edge.id === reference.id);
        const bindings = face.bindings.filter((binding) => {
          if (binding.edgeId !== reference.id) return false;
          const range = oldEdge
            ? binding.roomInterval.map((along, index) =>
                near(along, index === 0 ? 0 : oldEdge.length)
                  ? index === 0
                    ? 0
                    : reference.length
                  : project(reference, at(oldEdge, along)).along
              )
            : binding.roomInterval;
          return Math.min(span[1], range[1]) - Math.max(span[0], range[0]) >= -EPS;
        });
        const thicknesses = (bindings.length ? bindings : face.bindings).map((binding) =>
          buildingPlanSegmentThickness(
            wall,
            wall.segments.find((segment) => segment.id === binding.segmentId)
          )
        );
        const thickness = thicknesses[0];
        if (thicknesses.some((value) => !near(value, thickness)))
          reject(
            'jog_thickness_conflict',
            'The new return reaches segments with different thicknesses. Edit a shorter portion or resolve those thicknesses first.',
            { type: 'wall', id: wall.id }
          );
        if (!(thickness > EPS))
          reject(
            'unknown_wall_thickness',
            'Set a positive thickness for the adjacent wall before connecting this return.',
            { type: 'wall', id: wall.id }
          );
        aligned.add(room.id);
        const delta = multiply(
          reference.normal,
          -Math.sign(polygonArea(active.vertices)) * thickness
        );
        for (const vertex of room.vertices)
          if (vertex.id === edge.start.id || vertex.id === edge.end.id)
            Object.assign(vertex, cleanPoint(add(vertex, delta)));
        break;
      }
    }
  }
  return aligned;
}
