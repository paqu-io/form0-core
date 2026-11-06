import {
  GEOMETRY_EPSILON as EPS,
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
import { buildingPlanSegmentThickness, findWall, planIssue } from './model.js';

function reject(code, message, subject = null, details = {}) {
  throw Object.assign(new Error(message), { issues: [planIssue(code, message, subject, details)] });
}
function conflict(details) {
  reject(
    'corner_constraint_conflict',
    'These shared portions cannot meet while preserving the adjoining wall. Split a shorter portion or move a different corner.',
    null,
    details
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
    const referenceAxis =
      reference.axis ||
      segmentFrame(
        at(reference.edge, 0, (-reference.sign * reference.thickness) / 2),
        at(reference.edge, reference.edge.length, (-reference.sign * reference.thickness) / 2)
      );
    const offset = ((opposite ? -1 : 1) * reference.sign * reference.thickness) / 2;
    const line = segmentFrame(
      at(referenceAxis, 0, offset),
      at(referenceAxis, referenceAxis.length, offset)
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
      if (edit[end ? 'joinEnd' : 'joinStart']) continue;
      let partial = !near(edit.interval[end], end ? edge.length : 0);
      const vertexId = end ? edge.end.id : edge.start.id;
      // Supplied incident lines are solved together by boundary projection. A contact
      // helper must not replace one of those explicit constraints with its old line.
      if (
        !partial &&
        (end ? edge.end : edge.start).editingCutId &&
        edits.some((other) => {
          if (other === edit || other.edgeId === edge.id) return false;
          const adjacent = edges.find((e) => e.id === other.edgeId);
          return (
            adjacent &&
            ((adjacent.start.id === vertexId && near(other.interval[0], 0)) ||
              (adjacent.end.id === vertexId && near(other.interval[1], adjacent.length)))
          );
        })
      )
        continue;
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
        if (
          reference.network &&
          reference.oldAxis &&
          Math.abs(dot(adjacent.tangent, reference.old.tangent)) >= 1 - EPS
        ) {
          const run = reference.network.runs.find(
            (run) => run.room.id === room.id && run.edge.id === adjacent.id
          );
          if (run && !reference.network.collinear(run.axis, reference.oldAxis)) continue;
        }
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

/** Project both sides of a generated editing-cut return from its single axis. */
function prepareCutConnections(room, edits, cutReferences) {
  const edges = polygonEdges(room);
  for (const edit of edits) {
    const edge = edges.find((e) => e.id === edit.edgeId);
    for (const end of [0, 1]) {
      if (!near(edit.interval[end], end ? edge.length : 0)) continue;
      const vertex = end ? edge.end : edge.start;
      const reference = cutReferences.find((r) => r.cutId === vertex.editingCutId);
      if (!reference) continue;
      const fixedEdge = edges.find(
        (e) => e.id !== edge.id && (e.start.id === vertex.id || e.end.id === vertex.id)
      );
      if (!fixedEdge) continue;
      if (edits.some((other) => other !== edit && other.edgeId === fixedEdge.id)) continue;
      if (Math.abs(dot(fixedEdge.tangent, edge.tangent)) < 1 - EPS) continue;
      const line = segmentFrame(
        at(reference.axis, 0, -reference.side * reference.half),
        at(reference.axis, reference.axis.length, -reference.side * reference.half)
      );
      const point = junctionIntersection(segmentFrame(edit.start, edit.end), line),
        fixed = junctionIntersection(fixedEdge, line);
      if (!point || !fixed) continue;
      edit[end ? 'end' : 'start'] = point;
      edit[end ? 'joinEnd' : 'joinStart'] = { point, fixed };
    }
  }
}

/**
 * Reconstruct a local boundary from changed lines and bound extents. Both wall-body
 * and corner edits cross this seam; physical ownership and history remain with callers.
 * Edits are updated to their resolved endpoints for physical-host extent reconciliation.
 */
export function reshapeBuildingPlanBoundary(
  room,
  edits,
  createId,
  references = [],
  cutReferences = []
) {
  const edges = polygonEdges(room);
  prepareCutConnections(room, edits, cutReferences);
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
      const cut = cutReferences.find(
        (reference) => reference.half === 0 && reference.cutId === vertices.get(id).editingCutId
      );
      // Straight incident lines still share one explicit cut station.
      if (cut && lines.length > 1) point = junctionIntersection(moving, cut.axis);
      else {
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
    }
    if (
      !point ||
      lines.some(
        (line) =>
          distance(line.start, line.end) > EPS &&
          Math.abs(project(segmentFrame(line.start, line.end), point).offset) > EPS
      )
    )
      conflict({ roomId: room.id, vertexId: id, lines, point });
    if (distance(vertices.get(id), point) > EPS) Object.assign(vertices.get(id), cleanPoint(point));
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
