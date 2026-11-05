import {
  GEOMETRY_EPSILON as EPS,
  at,
  cleanPoint,
  distance,
  isPoint,
  near,
  polygonEdges,
  polygonIssue,
  project,
  segmentFrame,
} from './geometry.js';
import {
  buildingPlanFaceSegments,
  buildingPlanSegmentThickness,
  copyBuildingPlanData as copy,
  findRoom,
  findWall,
  planIssue,
} from './model.js';
import {
  reshapeBuildingPlanBoundary,
  buildingPlanJunctionReferences,
  buildingPlanJunctionAllowance,
} from './junction-edits.js';

function conflict(code, message, subject = null) {
  throw Object.assign(new Error(message), { issues: [planIssue(code, message, subject)] });
}

/** Reshape one vertex and only the bound extents in neighbouring rooms; no layout solver. */
export function reshapeBuildingPlanCorner(floor, operation, createId) {
  const before = copy(floor),
    room = findRoom(floor, operation.roomId);
  const vertex = room.vertices.find((p) => p.id === operation.vertexId);
  if (!vertex || !isPoint(operation.point))
    conflict('invalid_corner', 'Choose an existing room corner and a finite position.');
  if (distance(vertex, operation.point) <= EPS)
    return { before, changedEdges: [], affectedWalls: [], transformed: new Set() };
  const oldEdges = copy(
    polygonEdges(room).filter((e) => e.start.id === vertex.id || e.end.id === vertex.id)
  );
  Object.assign(vertex, cleanPoint({ x: operation.point.x, y: operation.point.y }));
  if (polygonIssue(room.vertices))
    conflict(
      'invalid_room_geometry',
      'This corner would cross or collapse its room. Try a smaller move.'
    );
  const tasks = [];
  for (const old of oldEdges) {
    const edge = polygonEdges(room).find((e) => e.id === old.id);
    if (edge.length <= EPS)
      conflict('invalid_room_geometry', 'This corner would collapse a wall. Try a smaller move.');
    for (const face of before.rooms.find((r) => r.id === room.id).faces)
      for (const binding of face.bindings.filter((b) => b.edgeId === old.id))
        tasks.push({ wallId: face.wallId, binding, old, edge });
  }
  const affected = new Set(),
    transformed = new Set(),
    neighbourEdits = new Map(),
    extents = new Map();
  for (const wallId of new Set(tasks.map((t) => t.wallId))) {
    const wall = findWall(floor, wallId),
      oldWall = findWall(before, wallId);
    affected.add(wall);
    for (const original of oldWall.segments) {
      const selected = tasks.filter(
        (t) => t.wallId === wallId && t.binding.segmentId === original.id
      );
      if (!selected.length) continue;
      const frame = segmentFrame(original.start, original.end);
      // A mitred host can extend one thickness beyond its room-facing edge.
      // Transform that connected cap with the line, rather than leaving a stale stub.
      for (const task of selected) {
        const cap = buildingPlanSegmentThickness(oldWall, original) || 0;
        task.binding = { ...task.binding, interval: [...task.binding.interval] };
        const oldRoom = before.rooms.find((r) => r.id === room.id);
        const start = task.binding.direction > 0 ? task.old.start : task.old.end;
        const end = task.binding.direction > 0 ? task.old.end : task.old.start;
        if (
          task.binding.interval[0] <=
          buildingPlanJunctionAllowance(before, oldRoom, task.old, start, cap) + EPS
        )
          task.binding.interval[0] = 0;
        if (
          frame.length - task.binding.interval[1] <=
          buildingPlanJunctionAllowance(before, oldRoom, task.old, end, cap) + EPS
        )
          task.binding.interval[1] = frame.length;
      }
      const cuts = [0, frame.length, ...selected.flatMap((t) => t.binding.interval)]
        .sort((a, b) => a - b)
        .filter((v, i, a) => !i || !near(v, a[i - 1]));
      const pieces = [];
      for (let i = 0; i < cuts.length - 1; i++) {
        const from = cuts[i],
          to = cuts[i + 1];
        const oldPiece = {
          ...copy(original),
          id: i ? createId() : original.id,
          start: at(frame, from),
          end: at(frame, to),
          lineage: { segmentId: original.id, interval: [from, to] },
        };
        const piece = copy(oldPiece);
        pieces.push(piece);
        const task = selected.find(
          (t) => from >= t.binding.interval[0] - EPS && to <= t.binding.interval[1] + EPS
        );
        if (!task) continue;
        const map = (p) => {
          const value = project(task.old, p);
          return cleanPoint(
            at(task.edge, (value.along * task.edge.length) / task.old.length, value.offset)
          );
        };
        piece.start = map(piece.start);
        piece.end = map(piece.end);
        transformed.add(piece.id);
        const newFrame = segmentFrame(piece.start, piece.end);
        const half =
          (buildingPlanSegmentThickness(oldWall, original) ?? original.referenceOffset * 2) / 2;
        for (const neighbour of before.rooms.filter((r) => r.id !== room.id))
          for (const face of neighbour.faces.filter((f) => f.wallId === wallId && !f.freePath))
            for (const binding of face.bindings.filter((b) => b.segmentId === original.id)) {
              const low = Math.max(from, binding.interval[0]),
                high = Math.min(to, binding.interval[1]);
              if (high - low <= EPS) continue;
              const oldEdge = polygonEdges(neighbour).find((e) => e.id === binding.edgeId);
              const ends = [low, high]
                .map((s) => ({
                  along: project(oldEdge, at(frame, s, binding.side * half)).along,
                  point: at(
                    newFrame,
                    ((s - from) / (to - from)) * newFrame.length,
                    binding.side * half
                  ),
                }))
                .sort((a, b) => a.along - b.along);
              const edit = {
                edgeId: oldEdge.id,
                activeEdgeId: task.old.id,
                interval: ends.map((e) => e.along),
                start: ends[0].point,
                end: ends[1].point,
              };
              const points = extents.get(piece) || [];
              points.push(edit);
              extents.set(piece, points);
              const list = neighbourEdits.get(neighbour.id) || [];
              list.push(edit);
              neighbourEdits.set(neighbour.id, list);
            }
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
            'An opening crosses this corner edit. Move it or split a different portion.',
            { type: opening.type, id: opening.id }
          );
        const piece = pieces[index],
          oldLength = cuts[index + 1] - cuts[index];
        opening.segmentId = piece.id;
        opening.offset -= cuts[index];
        const task = selected.find(
          (t) =>
            cuts[index] >= t.binding.interval[0] - EPS &&
            cuts[index + 1] <= t.binding.interval[1] + EPS
        );
        if (
          task &&
          (task.old.start.id === vertex.id
            ? task.binding.direction > 0
            : task.binding.direction < 0)
        )
          opening.offset = distance(piece.start, piece.end) - (oldLength - opening.offset);
      }
      wall.segments.splice(
        wall.segments.findIndex((s) => s.id === original.id),
        1,
        ...pieces
      );
    }
  }
  const changedEdges = [{ roomId: room.id, edgeIds: [] }];
  for (const [id, edits] of neighbourEdits)
    changedEdges.push({
      roomId: id,
      edgeIds: reshapeBuildingPlanBoundary(
        findRoom(floor, id),
        edits,
        createId,
        buildingPlanJunctionReferences(floor, before, room.id)
      ),
    });
  for (const [piece, points] of extents) {
    const frame = segmentFrame(piece.start, piece.end);
    const range = [
      0,
      frame.length,
      ...points.flatMap((edit) => [edit.start, edit.end]).map((p) => project(frame, p).along),
    ];
    const low = Math.min(...range),
      high = Math.max(...range);
    const from = near(low, 0) ? 0 : low,
      to = near(high, frame.length) ? frame.length : high;
    piece.start = at(frame, from);
    piece.end = at(frame, to);
    for (const wall of affected)
      for (const opening of [...wall.doors, ...wall.windows])
        if (opening.segmentId === piece.id) opening.offset -= from;
  }
  for (const wall of affected)
    for (const opening of [...wall.doors, ...wall.windows]) {
      const field = `${opening.type}_offset_m`;
      if (Object.hasOwn(opening.values, field)) opening.values[field] = opening.offset;
    }
  return { before, changedEdges, affectedWalls: [...affected], transformed };
}

/** Pins are transient editor constraints, checked for every supplied operation before commit. */
export function buildingPlanPinIssues(before, after, ids = []) {
  const geometry = (snapshot, id) => {
    for (const floor of snapshot.floors)
      for (const room of floor.rooms) {
        const face = room.faces.find((f) => f.id === id);
        if (face)
          return buildingPlanFaceSegments(floor, room, face).map(({ start, end }) => [start, end]);
      }
    return null;
  };
  return ids.flatMap((id) => {
    const a = geometry(before, id),
      b = geometry(after, id);
    return a &&
      b &&
      a.length === b.length &&
      a.every((pair, i) => pair.every((p, j) => distance(p, b[i][j]) <= EPS))
      ? []
      : [
          planIssue(
            'pinned_wall_conflict',
            'This edit would move a pinned wall. Unpin it or choose another corner.',
            { type: 'room_face', id }
          ),
        ];
  });
}
