import {
  GEOMETRY_EPSILON as EPS,
  add,
  at,
  cleanPoint,
  distance,
  dot,
  isPoint,
  multiply,
  near,
  polygonArea,
  polygonEdges,
  project,
  segmentFrame,
} from './geometry.js';
import {
  buildingPlanSegmentThickness,
  copyBuildingPlanData as copy,
  findFace,
  findRoom,
  findWall,
  planIssue,
} from './model.js';
import { createBuildingPlanAxisNetwork } from './axis-network.js';
import { normalizeRoomBoundary } from './topology.js';
import {
  buildingPlanJunctionAllowance,
  buildingPlanJunctionReferences,
  junctionIntersection,
  resolveBuildingPlanConnection,
  reshapeBuildingPlanBoundary,
} from './junction-edits.js';

function conflict(code, message, subject = null) {
  throw Object.assign(new Error(message), { issues: [planIssue(code, message, subject)] });
}
const spanInside = (a, b) => a[0] >= b[0] - EPS && a[1] <= b[1] + EPS;

/**
 * Plan changed supporting axes before deriving any room boundary. Physical subjects
 * supply properties/hosts; geometric incidence supplies propagation. Both wall and
 * corner operations use this candidate planner and the same boundary projection.
 */
export function reshapeBuildingPlanAxes(floor, operation, createId) {
  const before = copy(floor),
    network = createBuildingPlanAxisNetwork(before);
  const room =
    operation.type === 'move_corner'
      ? findRoom(floor, operation.roomId)
      : findFace(floor, operation.faceId).room;
  const oldRoom = findRoom(before, room.id),
    oldEdges = polygonEdges(oldRoom),
    changes = [],
    activeEdits = [],
    fittedRoomIds = new Set();
  if (operation.type === 'move_corner') {
    const vertex = oldRoom.vertices.find((v) => v.id === operation.vertexId);
    if (!vertex || !isPoint(operation.point))
      conflict('invalid_corner', 'Choose an existing room corner and a finite position.');
    if (distance(vertex, operation.point) <= EPS)
      return {
        before,
        changedEdges: [],
        affectedWalls: [],
        transformed: new Set(),
        activeRoomId: room.id,
      };
    const incident = oldEdges.filter(
      (edge) => edge.start.id === vertex.id || edge.end.id === vertex.id
    );
    const used = new Set();
    for (const edge of incident) {
      const run = [edge];
      const movingAtStart = edge.start.id === vertex.id;
      let fixed = movingAtStart ? edge.end : edge.start;
      if (!vertex.physicalBoundaryId || vertex.editingCutId) {
        while (fixed.physicalBoundaryId && !fixed.editingCutId) {
          const adjacent = oldEdges.find(
            (candidate) =>
              !run.includes(candidate) &&
              (movingAtStart ? candidate.start.id === fixed.id : candidate.end.id === fixed.id)
          );
          if (
            !adjacent ||
            Math.abs(dot(edge.normal, adjacent.tangent)) > EPS ||
            dot(edge.tangent, adjacent.tangent) < 1 - EPS
          )
            break;
          run.push(adjacent);
          fixed = movingAtStart ? adjacent.end : adjacent.start;
        }
      }
      const frame = segmentFrame(fixed, vertex);
      const mapped = (point) => {
        const ratio = project(frame, point).along / frame.length;
        return cleanPoint({
          ...point,
          x: fixed.x + (operation.point.x - fixed.x) * ratio,
          y: fixed.y + (operation.point.y - fixed.y) * ratio,
        });
      };
      for (const old of run) {
        if (used.has(old.id)) continue;
        used.add(old.id);
        const start = mapped(old.start),
          end = mapped(old.end);
        if (distance(start, end) <= EPS)
          conflict(
            'invalid_room_geometry',
            'This corner would collapse a wall. Try a smaller move.'
          );
        activeEdits.push({ edgeId: old.id, interval: [0, old.length], start, end });
      }
    }
  } else {
    const { face } = findFace(before, operation.faceId);
    if (face.freePath)
      conflict('unsupported_face_edit', 'Resize the host wall of an internal partition directly.');
    const bindings = face.bindings.filter(
      (b) => !operation.edgeId || b.edgeId === operation.edgeId
    );
    const ids = [...new Set(bindings.map((b) => b.edgeId))];
    if (ids.length !== 1)
      conflict('ambiguous_face_edit', 'Choose the specific straight room edge to edit.', {
        type: 'room_face',
        id: face.id,
      });
    const old = oldEdges.find((e) => e.id === ids[0]);
    const interval = operation.interval || [
      Math.min(...bindings.map((b) => b.roomInterval[0])),
      Math.max(...bindings.map((b) => b.roomInterval[1])),
    ];
    if (!Number.isFinite(operation.distance))
      conflict('invalid_dimension', 'A finite face displacement is required.');
    if (Math.abs(operation.distance) <= EPS)
      return {
        before,
        changedEdges: [],
        affectedWalls: [],
        transformed: new Set(),
        activeRoomId: room.id,
      };
    if (interval[0] < -EPS || interval[1] > old.length + EPS || interval[1] - interval[0] <= EPS)
      conflict('invalid_dimension', 'The edited extent is outside its room edge.');
    const delta = multiply(
      old.normal,
      -Math.sign(polygonArea(oldRoom.vertices)) * operation.distance
    );
    activeEdits.push({
      edgeId: old.id,
      interval,
      start: cleanPoint(add(at(old, interval[0]), delta)),
      end: cleanPoint(add(at(old, interval[1]), delta)),
    });
    for (const end of [0, 1]) {
      const vertex = end ? old.end : old.start;
      if (
        !vertex.physicalBoundaryId ||
        vertex.editingCutId ||
        !near(interval[end], end ? old.length : 0)
      )
        continue;
      const cap = oldEdges.find(
        (edge) => edge.id !== old.id && (edge.start.id === vertex.id || edge.end.id === vertex.id)
      );
      if (!cap || Math.abs(dot(old.normal, cap.tangent)) > EPS) continue;
      const far = cap.start.id === vertex.id ? cap.end : cap.start;
      if (far.editingCutId) continue;
      const run = network.runs.find((run) => run.room.id === room.id && run.edge.id === cap.id);
      if (!run) continue;
      const reach = buildingPlanJunctionAllowance(before, oldRoom, cap, far, run.half * 2);
      if (!(reach > EPS) || cap.length > reach + EPS) continue;
      const shoulder = oldEdges.find(
        (edge) => edge.id !== cap.id && (edge.start.id === far.id || edge.end.id === far.id)
      );
      if (!shoulder) continue;
      const outside = shoulder.start.id === far.id ? shoulder.end : shoulder.start;
      const continuation = oldEdges.find(
        (edge) =>
          edge.id !== shoulder.id && (edge.start.id === outside.id || edge.end.id === outside.id)
      );
      const target = segmentFrame(activeEdits[0].start, activeEdits[0].end);
      if (
        !continuation ||
        Math.abs(dot(target.normal, continuation.tangent)) > EPS ||
        Math.abs(project(target, continuation.start).offset) > EPS
      )
        continue;
      // A short collinear material cap belongs to the connected junction. Move
      // it with the supporting line while keeping its physical answers separate.
      activeEdits.push({
        edgeId: cap.id,
        interval: [0, cap.length],
        start: cleanPoint(add(cap.start, delta)),
        end: cleanPoint(add(cap.end, delta)),
      });
    }
  }
  for (const edit of activeEdits) {
    const old = oldEdges.find((e) => e.id === edit.edgeId);
    for (const run of network.runs.filter((r) => r.room.id === room.id && r.edge.id === old.id)) {
      const low = Math.max(edit.interval[0], run.binding.roomInterval[0]),
        high = Math.min(edit.interval[1], run.binding.roomInterval[1]);
      if (high - low <= EPS) continue;
      const targetFace =
        operation.type === 'move_corner'
          ? segmentFrame(edit.start, edit.end)
          : segmentFrame(
              cleanPoint(
                add(old.start, {
                  x: edit.start.x - at(old, edit.interval[0]).x,
                  y: edit.start.y - at(old, edit.interval[0]).y,
                })
              ),
              cleanPoint(
                add(old.end, {
                  x: edit.start.x - at(old, edit.interval[0]).x,
                  y: edit.start.y - at(old, edit.interval[0]).y,
                })
              )
            );
      const oldAxis = segmentFrame(
        at(run.axis, project(run.axis, old.start).along),
        at(run.axis, project(run.axis, old.end).along)
      );
      const axis = segmentFrame(
        at(targetFace, 0, -run.side * run.half),
        at(targetFace, targetFace.length, -run.side * run.half)
      );
      const whole =
        near(low, run.binding.roomInterval[0]) && near(high, run.binding.roomInterval[1]);
      const span = whole ? run.span : [low, high].map((s) => project(run.axis, at(old, s)).along);
      changes.push({
        id: changes.length,
        run,
        old,
        targetFace,
        oldAxis,
        axis,
        span,
        map: (p) => {
          const value = project(oldAxis, p);
          return at(axis, (value.along * axis.length) / oldAxis.length, value.offset);
        },
      });
    }
  }
  const tasks = [],
    editsByRoom = new Map(),
    links = [];
  for (const change of changes)
    for (const user of network.users(change.run, change.span)) {
      const { run } = user;
      const physical = run.physical;
      const interval = user.whole
        ? [...run.binding.interval]
        : user.interval.map((s) => project(physical, at(run.edge, s)).along).sort((a, b) => a - b);
      // Room-facing capture may stop before the geometric corner's material cap.
      if (user.whole) {
        const t = buildingPlanSegmentThickness(run.wall, run.segment) || 0;
        const start = run.binding.direction > 0 ? run.edge.start : run.edge.end,
          end = run.binding.direction > 0 ? run.edge.end : run.edge.start;
        if (
          interval[0] <=
          buildingPlanJunctionAllowance(before, run.room, run.edge, start, t) + EPS
        )
          interval[0] = 0;
        if (
          physical.length - interval[1] <=
          buildingPlanJunctionAllowance(before, run.room, run.edge, end, t) + EPS
        )
          interval[1] = physical.length;
      }
      tasks.push({ wallId: run.wall.id, segmentId: run.segment.id, interval, change });
      if (run.room.id === room.id) continue;
      const edit = {
        edgeId: run.edge.id,
        activeEdgeId: change.old.id,
        interval: [...user.interval],
        start: change.map(at(run.edge, user.interval[0])),
        end: change.map(at(run.edge, user.interval[1])),
      };
      const list = editsByRoom.get(run.room.id) || [];
      const duplicate = list.find(
        (e) =>
          e.edgeId === edit.edgeId &&
          near(e.interval[0], edit.interval[0]) &&
          near(e.interval[1], edit.interval[1]) &&
          distance(e.start, edit.start) <= EPS &&
          distance(e.end, edit.end) <= EPS
      );
      if (!duplicate) list.push(edit);
      editsByRoom.set(run.room.id, list);
      links.push({
        wallId: run.wall.id,
        segmentId: run.segment.id,
        change,
        edit: duplicate || edit,
      });
    }
  // Coalesce geometric users before partitioning a physical segment. Explicit cuts
  // with different target lines remain separate transforms even on the same subject.
  const merged = [];
  for (const task of tasks.sort((a, b) => a.interval[0] - b.interval[0])) {
    const same = merged.find(
      (t) =>
        t.wallId === task.wallId &&
        t.segmentId === task.segmentId &&
        t.change.id === task.change.id &&
        task.interval[0] <= t.interval[1] + EPS &&
        task.interval[1] >= t.interval[0] - EPS
    );
    if (same) {
      same.interval[0] = Math.min(same.interval[0], task.interval[0]);
      same.interval[1] = Math.max(same.interval[1], task.interval[1]);
    } else merged.push({ ...task, interval: [...task.interval] });
  }
  const affected = new Set(),
    transformed = new Set(),
    mapped = [];
  for (const wallId of new Set(merged.map((t) => t.wallId))) {
    const wall = findWall(floor, wallId),
      oldWall = findWall(before, wallId);
    affected.add(wall);
    for (const original of oldWall.segments) {
      const selected = merged.filter((t) => t.wallId === wallId && t.segmentId === original.id);
      if (!selected.length) continue;
      const frame = segmentFrame(original.start, original.end);
      const cuts = [0, frame.length, ...selected.flatMap((t) => t.interval)]
        .sort((a, b) => a - b)
        .filter((v, i, a) => !i || !near(v, a[i - 1]));
      const pieces = [];
      const retainedIndex = cuts.findIndex(
        (v, i) =>
          i < cuts.length - 1 && selected.some((t) => spanInside([v, cuts[i + 1]], t.interval))
      );
      for (let i = 0; i < cuts.length - 1; i++) {
        const from = cuts[i],
          to = cuts[i + 1],
          task = selected.find((t) => spanInside([from, to], t.interval));
        const piece = {
          ...copy(original),
          id: i === retainedIndex ? original.id : createId(),
          start: at(frame, from),
          end: at(frame, to),
          lineage: { segmentId: original.id, interval: [from, to] },
        };
        if (task) {
          piece.start = task.change.map(piece.start);
          piece.end = task.change.map(piece.end);
          transformed.add(piece.id);
          mapped.push({ piece, wall, original, task });
        }
        pieces.push(piece);
      }
      for (const opening of [...wall.doors, ...wall.windows].filter(
        (o) => o.segmentId === original.id
      )) {
        const index = cuts.findIndex(
          (v, i) =>
            i < cuts.length - 1 &&
            opening.offset >= v - EPS &&
            opening.offset + opening.width <= cuts[i + 1] + EPS
        );
        if (index < 0)
          conflict(
            'opening_crosses_edit_boundary',
            'An opening crosses this wall edit. Move it or split a different portion.',
            { type: opening.type, id: opening.id }
          );
        const from = cuts[index],
          to = cuts[index + 1],
          piece = pieces[index],
          task = selected.find((t) => spanInside([from, to], t.interval));
        opening.segmentId = piece.id;
        opening.offset -= from;
        if (task && operation.type === 'move_corner') {
          const aligned = dot(frame.tangent, task.change.oldAxis.tangent) > 0;
          const movingStart = task.change.old.start.id === operation.vertexId;
          if (movingStart === aligned)
            opening.offset = distance(piece.start, piece.end) - (to - from - opening.offset);
        }
      }
      wall.segments.splice(
        wall.segments.findIndex((s) => s.id === original.id),
        1,
        ...pieces
      );
    }
  }
  const references = buildingPlanJunctionReferences(before, before, room.id).map((reference) => {
    const change = changes.find((c) => c.old.id === reference.old.id);
    const run = network.runs.find((r) => r.room.id === room.id && r.edge.id === reference.old.id);
    return {
      ...reference,
      edge: change ? { ...reference.edge, ...change.targetFace } : reference.edge,
      axis: change?.axis || run?.axis,
      oldAxis: run?.axis,
      network,
    };
  });
  // An automatic adjacency station can meet a true corner on the other room.
  // Its new connector follows that existing material band, including its far face.
  if (operation.type !== 'move_corner') {
    for (const edit of activeEdits) {
      if (distance(edit.start, edit.end) <= EPS) continue;
      const old = oldEdges.find((edge) => edge.id === edit.edgeId);
      const source = network.runs.find((run) => run.room.id === room.id && run.edge.id === old.id);
      if (!source) continue;
      const fitStationary =
        source.face.id === operation.faceId &&
        !network.runs.some((run) => run.wall.id === source.wall.id && run.room.id !== room.id);
      for (const end of [0, 1]) {
        const vertex = end ? old.end : old.start;
        if (
          !vertex.physicalBoundaryId ||
          vertex.editingCutId ||
          !near(edit.interval[end], end ? old.length : 0)
        )
          continue;
        let stationary = oldEdges.find(
          (edge) => edge.id !== old.id && (edge.start.id === vertex.id || edge.end.id === vertex.id)
        );
        let junction = vertex;
        const connectionEdges = [];
        while (fitStationary && stationary && Math.abs(dot(stationary.normal, old.tangent)) > EPS) {
          const endpoint = stationary.start.id === junction.id ? stationary.end : stationary.start;
          if (!endpoint.physicalBoundaryId || endpoint.editingCutId) break;
          connectionEdges.push(stationary);
          junction = endpoint;
          stationary = oldEdges.find(
            (edge) =>
              !connectionEdges.includes(edge) &&
              edge.id !== old.id &&
              (edge.start.id === junction.id || edge.end.id === junction.id)
          );
        }
        if (!fitStationary && stationary && Math.abs(dot(stationary.normal, old.tangent)) > EPS) {
          const far = stationary.start.id === vertex.id ? stationary.end : stationary.start;
          if (far.physicalBoundaryId !== vertex.physicalBoundaryId || far.editingCutId) continue;
          stationary = oldEdges.find(
            (edge) =>
              edge.id !== stationary.id &&
              edge.id !== old.id &&
              (edge.start.id === far.id || edge.end.id === far.id)
          );
        }
        if (!stationary || Math.abs(dot(stationary.normal, old.tangent)) > EPS) continue;
        const sourceWalls = new Set([
          source.wall.id,
          ...network.runs
            .filter(
              (run) =>
                fitStationary &&
                run.room.id === room.id &&
                network.runs.some(
                  (reference) =>
                    reference.room.id === room.id &&
                    reference.edge.id === stationary.id &&
                    network.collinear(reference.axis, run.axis)
                )
            )
            .map((run) => run.wall.id),
        ]);
        const neighbours = new Set(
          network.runs
            .filter((run) => sourceWalls.has(run.wall.id) && run.room.id !== room.id)
            .map((run) => run.room.id)
        );
        const transverse = network.runs
          .filter(
            (run) =>
              neighbours.has(run.room.id) &&
              Math.abs(dot(run.axis.normal, source.axis.tangent)) > EPS &&
              [run.edge.start, run.edge.end].some(
                (point) => distance(point, junction) <= (source.half + run.half) * 2 + EPS
              )
          )
          .sort(
            (a, b) =>
              Number(Boolean(a.segment.junction)) - Number(Boolean(b.segment.junction)) ||
              b.axis.length - a.axis.length
          )[0];
        if (!transverse) continue;
        const joined = resolveBuildingPlanConnection(
          segmentFrame(edit.start, edit.end),
          stationary,
          {
            axis: transverse.axis,
            edge: transverse.edge,
            sign: Math.sign(polygonArea(transverse.room.vertices)),
            thickness: transverse.half * 2,
          },
          end,
          Math.sign(polygonArea(room.vertices))
        );
        if (joined) {
          edit[end ? 'end' : 'start'] = joined.point;
          edit[end ? 'joinEnd' : 'joinStart'] = joined;
          if (fitStationary) {
            fittedRoomIds.add(room.id);
            for (const edge of connectionEdges) {
              if (activeEdits.some((entry) => entry.edgeId === edge.id)) continue;
              activeEdits.push({
                edgeId: edge.id,
                interval: [0, edge.length],
                start: joined.fixed,
                end: joined.fixed,
              });
            }
          }
        }
      }
    }
  }
  // Resolve the active path first so both room sides use one generated cut-return axis.
  const changedEdges = [
    { roomId: room.id, edgeIds: reshapeBuildingPlanBoundary(room, activeEdits, createId) },
  ];
  // A returning piece can temporarily fold over its own connector. Resolve that
  // zero-area geometry before deriving the shared cut station for the other side.
  normalizeRoomBoundary(floor, room, createId);
  const cutReferences = [];
  for (const vertex of room.vertices.filter((v) => v.editingCutId || v.physicalBoundaryId)) {
    if (cutReferences.some((r) => r.cutId === (vertex.editingCutId || vertex.physicalBoundaryId)))
      continue;
    const connector = room.vertices
      .flatMap((start, i) => {
        const end = room.vertices[(i + 1) % room.vertices.length];
        return distance(start, end) > EPS ? [{ ...segmentFrame(start, end) }] : [];
      })
      .find(
        (edge) =>
          (edge.start.editingCutId || edge.start.physicalBoundaryId) ===
            (vertex.editingCutId || vertex.physicalBoundaryId) &&
          (edge.end.editingCutId || edge.end.physicalBoundaryId) ===
            (vertex.editingCutId || vertex.physicalBoundaryId)
      );
    const oldVertex = oldRoom.vertices.find(
      (v) =>
        (v.editingCutId || v.physicalBoundaryId) ===
        (vertex.editingCutId || vertex.physicalBoundaryId)
    );
    const source = changes.find(
      (c) =>
        (c.old.start.editingCutId || c.old.start.physicalBoundaryId) ===
          (vertex.editingCutId || vertex.physicalBoundaryId) ||
        (c.old.end.editingCutId || c.old.end.physicalBoundaryId) ===
          (vertex.editingCutId || vertex.physicalBoundaryId)
    );
    if (!source || !oldVertex) continue;
    if (!connector) {
      const incident = room.vertices.flatMap((start, i) => {
        const end = room.vertices[(i + 1) % room.vertices.length];
        return (start.id === vertex.id || end.id === vertex.id) && distance(start, end) > EPS
          ? [segmentFrame(start, end)]
          : [];
      });
      if (incident.length === 2 && Math.abs(dot(incident[0].normal, incident[1].tangent)) > EPS)
        continue;
    }
    const side = Math.sign(polygonArea(room.vertices)),
      half = connector ? source.run.half : 0;
    const line = connector || segmentFrame(vertex, add(vertex, source.axis.normal));
    const axis = segmentFrame(at(line, 0, -side * half), at(line, line.length, -side * half));
    cutReferences.push({
      cutId: vertex.editingCutId || vertex.physicalBoundaryId,
      axis,
      side,
      half,
    });
  }
  for (const [id, edits] of editsByRoom) {
    const neighbour = findRoom(floor, id);
    changedEdges.push({
      roomId: id,
      edgeIds: reshapeBuildingPlanBoundary(neighbour, edits, createId, references, cutReferences),
    });
    normalizeRoomBoundary(floor, neighbour, createId);
    // When a connector straightens, the fixed and moving endpoints can retain
    // different along-line stations. Both room sides must keep the same cut axis.
    const edges = polygonEdges(neighbour);
    for (const vertex of neighbour.vertices.filter((point) => point.editingCutId)) {
      const reference = cutReferences.find(
        (entry) => entry.cutId === vertex.editingCutId && entry.half === 0
      );
      const incoming = edges.find((edge) => edge.end.id === vertex.id);
      const outgoing = edges.find((edge) => edge.start.id === vertex.id);
      if (
        !reference ||
        !incoming ||
        !outgoing ||
        Math.abs(dot(incoming.normal, outgoing.tangent)) > EPS
      )
        continue;
      const station = junctionIntersection(incoming, reference.axis);
      if (!station) continue;
      const span = segmentFrame(incoming.start, outgoing.end);
      const along = project(span, station).along;
      if (along >= -EPS && along <= span.length + EPS) Object.assign(vertex, cleanPoint(station));
    }
    normalizeRoomBoundary(floor, neighbour, createId);
  }
  for (const { piece, wall, original, task } of mapped) {
    const frame = segmentFrame(piece.start, piece.end);
    const points = links
      .filter(
        (link) =>
          link.wallId === wall.id &&
          link.segmentId === original.id &&
          link.change.id === task.change.id
      )
      .flatMap((link) => [link.edit.start, link.edit.end]);
    const range = [0, frame.length, ...points.map((p) => project(frame, p).along)];
    const from = near(Math.min(...range), 0) ? 0 : Math.min(...range),
      to = Math.max(...range);
    piece.start = at(frame, from);
    piece.end = at(frame, to);
    for (const opening of [...wall.doors, ...wall.windows])
      if (opening.segmentId === piece.id) opening.offset -= from;
  }
  return {
    before,
    changedEdges,
    affectedWalls: [...affected],
    transformed,
    activeRoomId: room.id,
    fittedRoomIds: [...fittedRoomIds],
  };
}

/** Solve changed thicknesses together from accepted axes, then derive all room faces once. */
export function reshapeBuildingPlanAxisThickness(floor, before, operation, createId) {
  const network = createBuildingPlanAxisNetwork(before),
    editsByRoom = new Map(),
    transformed = new Set(),
    affected = new Set();

  for (const wall of floor.walls) {
    const oldWall = before.walls.find((w) => w.id === wall.id);
    if (!oldWall) continue;
    for (const segment of wall.segments) {
      const old = oldWall.segments.find((s) => s.id === segment.id);
      if (!old) continue;
      const oldT = buildingPlanSegmentThickness(oldWall, old) ?? old.referenceOffset * 2,
        nextT = buildingPlanSegmentThickness(wall, segment);
      if (nextT == null || near(oldT, nextT)) continue;
      if (!(nextT > 0))
        conflict('invalid_dimension', 'Wall thickness must be positive or explicitly unknown.');
      const users = [...network.runs, ...network.partitions].filter(
        (r) => r.wall.id === wall.id && r.segment.id === segment.id
      );
      const anchor =
        users.find(
          (r) => r.room.id === (operation.activeRoomsByWall?.[wall.id] || operation.activeRoomId)
        ) ||
        users.find((r) => r.face.id === wall.referenceFaceId) ||
        users[0];
      if (!anchor) continue;
      const frame = segmentFrame(old.start, old.end),
        delta = nextT - oldT;
      let shift =
        operation.thicknessAnchor === 'midline'
          ? { x: 0, y: 0 }
          : multiply(frame.normal, (-anchor.binding.side * delta) / 2);
      const sourceId = wall.lineage?.profileSource?.wallId;
      const source = floor.walls.find((other) => other.id === sourceId);
      const previousSource = before.walls.find((other) => other.id === sourceId);
      if (source && previousSource) {
        const reference = segmentFrame(
          previousSource.segments[0].start,
          previousSource.segments[0].end
        );
        if (
          Math.abs(dot(reference.tangent, frame.tangent)) >= 1 - EPS &&
          Math.abs(project(reference, old.start).offset) <= EPS
        ) {
          // A collinear cap follows its supplying axis, including when thickness shrinks.
          // Its sole projected face must not become a separately anchored physical wall.
          shift = multiply(reference.normal, project(reference, source.segments[0].start).offset);
        }
      }
      segment.start = cleanPoint(add(old.start, shift));
      segment.end = cleanPoint(add(old.end, shift));
      segment.referenceOffset = nextT / 2;
      transformed.add(segment.id);
      affected.add(wall);
      const axis = segmentFrame(segment.start, segment.end);
      for (const run of users) {
        const point = (along) =>
          at(axis, project(frame, at(run.edge, along)).along, (run.binding.side * nextT) / 2);
        const interval = [...run.binding.roomInterval];
        if (run.face.freePath) {
          const face = findFace(floor, run.face.id).face;
          const index = face.freeEdges.indexOf(run.edge.id);
          Object.assign(face.freePath[index], cleanPoint(point(0)));
          Object.assign(face.freePath[index + 1], cleanPoint(point(run.edge.length)));
          continue;
        }
        const start = point(interval[0]),
          end = point(interval[1]);
        if (
          distance(start, at(run.edge, interval[0])) <= EPS &&
          distance(end, at(run.edge, interval[1])) <= EPS
        )
          continue;
        const edit = {
          edgeId: run.edge.id,
          interval,
          start,
          end,
          activeEdgeId: run.room.id === anchor.room.id ? undefined : anchor.edge.id,
        };
        const list = editsByRoom.get(run.room.id) || [];
        list.push(edit);
        editsByRoom.set(run.room.id, list);
      }
    }
  }
  const changedEdges = [];
  for (const [id, edits] of editsByRoom)
    changedEdges.push({
      roomId: id,
      edgeIds: reshapeBuildingPlanBoundary(findRoom(floor, id), edits, createId),
    });
  return { before, changedEdges, affectedWalls: [...affected], transformed };
}
