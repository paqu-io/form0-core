import {
  sharedCornerMove,
  resolveReversedCorners,
  repairSharedWallExtents,
} from './boundary-edits.js';
import {
  GEOMETRY_EPSILON as EPS,
  add,
  at,
  assignRoomEdges,
  cleanPoint,
  distance,
  dot,
  multiply,
  near,
  polygonArea,
  polygonEdges,
  polygonIssue,
  project,
  segmentFrame,
  shiftRoomEdge,
  subtract,
} from './geometry.js';
import {
  copyBuildingPlanData as copy,
  createBuildingPlanFloor,
  buildingPlanFaceSegments,
  buildingPlanSegmentThickness,
  createBuildingPlanRoom,
  equalValue,
  facesOfWall,
  findBuildingPlanFloor,
  findFace,
  findRoom,
  findWall,
  own,
  planIssue,
  rebindBuildingPlanFaces,
  reconcileBuildingPlanProperties,
} from './model.js';
import {
  coalesceFacingRows,
  normalizeRoomBoundary,
  pruneAutomaticReturns,
  separatePhysicalWallRuns,
  splitFacingRows,
  wallTopologyOrigin,
} from './topology.js';

export function failOperation(code, message, subject = null, details = {}) {
  const error = new Error(message);
  error.issues = [planIssue(code, message, subject, details)];
  throw error;
}

const scalarKeys = new Set(['__proto__', 'prototype', 'constructor']);
function propertyKey(key) {
  if (typeof key !== 'string' || !key || scalarKeys.has(key))
    failOperation('invalid_property', 'A valid declared property name is required.');
}

function sourceEdges(room, face) {
  return face.freePath
    ? face.freePath.slice(0, -1).map((start, i) => ({
        id: face.freeEdges[i],
        ...segmentFrame(start, face.freePath[i + 1]),
      }))
    : polygonEdges(room).filter((edge) => !face.edgeIds || face.edgeIds.includes(edge.id));
}

function translateUnsharedRoom(floor, room, delta) {
  room.vertices = room.vertices.map((p) => cleanPoint({ ...p, ...add(p, delta) }));
  for (const face of room.faces) {
    const wall = findWall(floor, face.wallId);
    if (facesOfWall(floor, wall.id).some((entry) => entry.room.id !== room.id))
      failOperation(
        'shared_move_requires_detach',
        'Moving this room requires detaching its shared walls.'
      );
    for (const segment of wall.segments) {
      segment.start = cleanPoint(add(segment.start, delta));
      segment.end = cleanPoint(add(segment.end, delta));
    }
    if (face.freePath)
      face.freePath = face.freePath.map((p) => cleanPoint({ ...p, ...add(p, delta) }));
  }
  for (const collection of ['columns', 'beams', 'objects'])
    for (const item of room[collection] || []) {
      if (item.position) item.position = cleanPoint(add(item.position, delta));
      if (item.start) item.start = cleanPoint(add(item.start, delta));
      if (item.end) item.end = cleanPoint(add(item.end, delta));
    }
}

function remapOpeningForSegment(opening, oldSegment, newSegment, unchanged = null) {
  const oldLength = distance(oldSegment.start, oldSegment.end);
  const newLength = distance(newSegment.start, newSegment.end);
  const fixedStart =
    unchanged === 'start' || (!unchanged && near(distance(oldSegment.start, newSegment.start), 0));
  const fixedEnd =
    unchanged === 'end' || (!unchanged && near(distance(oldSegment.end, newSegment.end), 0));
  if (!fixedStart && fixedEnd) opening.offset = newLength - (oldLength - opening.offset);
  // Width and other measured dimensions deliberately remain unchanged.
}

/** Repair adjoining unshared walls after a room vertex changes. */
function repairUnsharedWalls(floor, before, createId) {
  for (const wall of floor.walls) {
    const linked = facesOfWall(floor, wall.id);
    for (const { room, face } of linked) {
      const oldRoom = before.rooms.find((entry) => entry.id === room.id);
      const oldFace = oldRoom?.faces.find((entry) => entry.id === face.id);
      const oldWall = before.walls.find((entry) => entry.id === wall.id);
      if (!oldFace || !oldWall) continue;
      const edges = sourceEdges(room, face);
      for (const binding of oldFace.bindings) {
        // A return belongs to one facing extent even when the physical wall is shared.
        const users = linked.filter((entry) =>
          before.rooms
            .find((candidate) => candidate.id === entry.room.id)
            ?.faces.find((candidate) => candidate.id === entry.face.id)
            ?.bindings.some((entry) => entry.segmentId === binding.segmentId)
        );
        if (users.length !== 1) continue;
        const edge = edges.find((entry) => entry.id === binding.edgeId);
        const segment = wall.segments.find((entry) => entry.id === binding.segmentId);
        const oldSegment = oldWall.segments.find((entry) => entry.id === binding.segmentId);
        if (!edge || !segment || !oldSegment) continue;
        const oldEdge = sourceEdges(oldRoom, oldFace).find((entry) => entry.id === binding.edgeId);
        if (
          !oldEdge ||
          !near(binding.roomInterval[0], 0) ||
          !near(binding.roomInterval[1], oldEdge.length)
        )
          continue;
        const half =
          (buildingPlanSegmentThickness(wall, segment) ?? (segment.referenceOffset ?? 0) * 2) / 2;
        const direction = binding.direction;
        const start =
          direction > 0
            ? at(edge, 0, -binding.side * half)
            : at(edge, edge.length, binding.side * half);
        const end =
          direction > 0
            ? at(edge, edge.length, -binding.side * half)
            : at(edge, 0, binding.side * half);
        segment.start = start;
        segment.end = end;
        for (const opening of [...wall.doors, ...wall.windows].filter(
          (entry) => entry.segmentId === segment.id
        ))
          remapOpeningForSegment(opening, oldSegment, segment);
      }
    }
  }
  rebindBuildingPlanFaces(floor, createId);
}

function splitGeometrySegment(wall, segment, low, high, delta, createId) {
  const frame = segmentFrame(segment.start, segment.end);
  const cuts = [0, low, high, frame.length].filter(
    (value, index, values) => index === 0 || !near(value, values[index - 1])
  );
  const pieces = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const from = cuts[i],
      to = cuts[i + 1];
    const moved = from >= low - EPS && to <= high + EPS;
    const shift = moved ? delta : { x: 0, y: 0 };
    pieces.push({
      ...segment,
      id: moved ? segment.id : createId(),
      start: cleanPoint(add(at(frame, from), shift)),
      end: cleanPoint(add(at(frame, to), shift)),
      lineage: { segmentId: segment.id, interval: [from, to] },
    });
  }
  for (const opening of [...wall.doors, ...wall.windows].filter(
    (entry) => entry.segmentId === segment.id
  )) {
    const index = cuts.findIndex(
      (from, i) =>
        i < cuts.length - 1 &&
        opening.offset >= from - EPS &&
        opening.offset + opening.width <= cuts[i + 1] + EPS
    );
    if (index < 0)
      failOperation(
        'opening_crosses_edit_boundary',
        'An opening spans the boundary of this partial edit. Move the opening or extend the edited portion.',
        { type: opening.type, id: opening.id }
      );
    opening.segmentId = pieces[index].id;
    opening.offset -= cuts[index];
  }
  const index = wall.segments.indexOf(segment);
  wall.segments.splice(index, 1, ...pieces);
}

function addJogGeometry(floor, wall, changedEdges, createId) {
  rebindBuildingPlanFaces(floor, createId);
  for (const { roomId, edgeIds } of changedEdges) {
    const room = findRoom(floor, roomId);
    const face = room.faces.find((entry) => entry.wallId === wall.id);
    if (!face) continue;
    const side = Math.sign(polygonArea(room.vertices));
    const half = (wall.properties.wall_thickness_m ?? 0) / 2;
    for (const edge of polygonEdges(room).filter((entry) => edgeIds.includes(entry.id))) {
      if (
        room.faces.some((entry) =>
          entry.bindings.some(
            (binding) =>
              binding.edgeId === edge.id &&
              near(binding.roomInterval[0], 0) &&
              near(binding.roomInterval[1], edge.length)
          )
        )
      )
        continue;
      wall.segments.push({
        id: createId(),
        start: at(edge, 0, -side * half),
        end: at(edge, edge.length, -side * half),
        referenceOffset: half,
        junction: true,
      });
    }
  }
  rebindBuildingPlanFaces(floor, createId);
}

function shiftBoundEdge(room, edgeId, interval, delta, createId, changedEdges) {
  const previous = new Set(room.edges.map((edge) => edge.id));
  const edge = room.edges.find((entry) => entry.id === edgeId);
  shiftRoomEdge(room, edgeId, interval, delta, createId);
  if (!room.edges.some((entry) => entry.id === edgeId)) {
    const start = room.vertices.findIndex((point) => point.id === edge.startId);
    const replacement = [];
    for (
      let i = start, count = 0;
      count < room.edges.length;
      count++, i = (i + 1) % room.edges.length
    ) {
      replacement.push(room.edges[i].id);
      if (room.edges[i].endId === edge.endId) break;
    }
    for (const face of room.faces)
      if (face.edgeIds?.includes(edgeId))
        face.edgeIds = face.edgeIds.flatMap((id) => (id === edgeId ? replacement : [id]));
  }
  changedEdges.push({
    roomId: room.id,
    edgeIds: room.edges.filter((edge) => !previous.has(edge.id)).map((edge) => edge.id),
  });
}

function resizeFace(floor, operation, createId) {
  const { room, face, wall } = findFace(floor, operation.faceId);
  if (face.freePath)
    failOperation(
      'unsupported_face_edit',
      'Resize the host wall of an internal partition directly.'
    );
  const selected = face.bindings.filter(
    (binding) => !operation.edgeId || binding.edgeId === operation.edgeId
  );
  const edgeIds = [...new Set(selected.map((binding) => binding.edgeId))];
  if (edgeIds.length !== 1)
    failOperation('ambiguous_face_edit', 'Choose the specific straight room edge to edit.', {
      type: 'room_face',
      id: face.id,
    });
  const edge = polygonEdges(room).find((entry) => entry.id === edgeIds[0]);
  const interval = operation.interval || [
    Math.min(...selected.map((binding) => binding.roomInterval[0])),
    Math.max(...selected.map((binding) => binding.roomInterval[1])),
  ];
  const amount = operation.distance;
  if (Number.isFinite(amount) && Math.abs(amount) <= EPS) return;
  if (!Number.isFinite(amount))
    failOperation('invalid_dimension', 'A finite face displacement is required.');
  const delta = multiply(edge.normal, -Math.sign(polygonArea(room.vertices)) * amount);
  const before = copy(floor);
  const changedEdges = [];
  const moves = [];
  const connections = [];
  for (const binding of selected) {
    const segment = wall.segments.find((entry) => entry.id === binding.segmentId);
    const frame = segmentFrame(segment.start, segment.end);
    const points = interval.map((along) => project(frame, at(edge, along)).along);
    const low = Math.max(binding.interval[0], Math.min(...points));
    const high = Math.min(binding.interval[1], Math.max(...points));
    if (high - low <= EPS) continue;
    for (const other of facesOfWall(floor, wall.id))
      for (const bound of other.face.bindings) {
        if (other.room.id === room.id || bound.segmentId !== segment.id) continue;
        const from = Math.max(low, bound.interval[0]);
        const to = Math.min(high, bound.interval[1]);
        if (to - from <= EPS) continue;
        const otherEdge = polygonEdges(other.room).find((entry) => entry.id === bound.edgeId);
        const offset =
          (bound.side *
            (buildingPlanSegmentThickness(wall, segment) ?? (segment.referenceOffset ?? 0) * 2)) /
          2;
        const move = sharedCornerMove(
          floor,
          room,
          edge,
          other.room,
          otherEdge,
          [
            project(otherEdge, at(frame, from, offset)).along,
            project(otherEdge, at(frame, to, offset)).along,
          ].sort((a, b) => a - b)
        );
        moves.push({ room: other.room, edgeId: bound.edgeId, interval: move.interval });
        connections.push(...move.connections);
      }
    splitGeometrySegment(wall, segment, low, high, delta, createId);
  }
  for (const move of moves)
    shiftBoundEdge(move.room, move.edgeId, move.interval, delta, createId, changedEdges);
  shiftBoundEdge(room, edge.id, interval, delta, createId, changedEdges);
  resolveReversedCorners(floor, connections);
  finishBoundaryEdit(floor, before, changedEdges, [wall], operation, createId);
}

function finishBoundaryEdit(floor, before, changedEdges, affectedWalls, operation, createId) {
  if (!changedEdges.length && !affectedWalls.length) return;
  for (const roomId of new Set(changedEdges.map((entry) => entry.roomId)))
    normalizeRoomBoundary(floor, findRoom(floor, roomId), createId);
  for (const candidate of floor.rooms) {
    const problem = polygonIssue(candidate.vertices);
    if (problem)
      failOperation(
        'invalid_room_geometry',
        `${affectedWalls[0]?.values.wall_label || 'This wall'} would cross or collapse Room ${floor.rooms.indexOf(candidate) + 1}. Move rejected; try a smaller drag.`,
        { type: 'room', id: candidate.id },
        { reason: problem }
      );
  }
  repairUnsharedWalls(floor, before, createId);
  repairSharedWallExtents(floor, before);
  rebindBuildingPlanFaces(floor, createId);
  for (const wall of affectedWalls) addJogGeometry(floor, wall, changedEdges, createId);
  for (const wall of affectedWalls) {
    const referenced = new Set(
      facesOfWall(floor, wall.id).flatMap(({ face }) =>
        face.bindings.map((binding) => binding.segmentId)
      )
    );
    wall.segments = wall.segments.filter(
      (segment) =>
        !segment.lineage?.segmentId ||
        before.walls.some((w) => w.segments.some((old) => old.id === segment.id)) ||
        referenced.has(segment.id) ||
        [...wall.doors, ...wall.windows].some((opening) => opening.segmentId === segment.id)
    );
  }
  pruneAutomaticReturns(floor);
  // Automatically introduced divisions can rejoin when their original alignment returns.
  for (const reference of [...floor.walls]) {
    if (
      !floor.walls.includes(reference) ||
      !reference.lineage?.jogOriginWallId ||
      reference.lineage.explicitPhysicalSeparation ||
      reference.segments.length !== 1
    )
      continue;
    for (const other of [...floor.walls]) {
      if (
        other === reference ||
        !floor.walls.includes(other) ||
        other.lineage?.explicitPhysicalSeparation ||
        other.segments.length !== 1 ||
        wallTopologyOrigin(other) !== wallTopologyOrigin(reference) ||
        !equalValue(reference.overrides, other.overrides)
      )
        continue;
      const a = segmentFrame(reference.segments[0].start, reference.segments[0].end);
      const b = segmentFrame(other.segments[0].start, other.segments[0].end);
      if (Math.abs(dot(a.normal, b.tangent)) > EPS || Math.abs(project(a, b.start).offset) > EPS)
        continue;
      const range = [project(a, b.start).along, project(a, b.end).along];
      if (Math.min(a.length, Math.max(...range)) < Math.max(0, Math.min(...range)) - EPS) continue;
      mergeWalls(floor, reference, other, {}, createId);
    }
  }
  coalesceFacingRows(floor);
  for (const wall of affectedWalls.filter(
    (wall) => floor.walls.includes(wall) && wall.segments.length > 1
  )) {
    wall.lineage = { ...wall.lineage, jogOriginWallId: wallTopologyOrigin(wall) };
    if (!operation.preserveWallGrouping) separatePhysicalWallRuns(floor, wall, createId);
  }
  splitFacingRows(floor, createId, new Map(), new Set(affectedWalls.map((wall) => wall.id)));
  rebindBuildingPlanFaces(floor, createId);
}

function detachRoom(floor, room, createId) {
  for (const face of room.faces) {
    const wall = findWall(floor, face.wallId);
    if (!facesOfWall(floor, wall.id).some((entry) => entry.room.id !== room.id)) continue;
    const replacement = {
      ...copy(wall),
      id: createId(),
      referenceFaceId: face.id,
      overrides: { ...copy(wall.properties) },
      doors: [],
      windows: [],
      lineage: { copiedFromWallId: wall.id, reason: 'room_detach' },
    };
    replacement.segments = wall.segments
      .filter((segment) => face.bindings.some((binding) => binding.segmentId === segment.id))
      .map((segment) => {
        const bindings = face.bindings.filter((binding) => binding.segmentId === segment.id);
        const frame = segmentFrame(segment.start, segment.end);
        const from = Math.min(...bindings.map((binding) => binding.interval[0]));
        const to = Math.max(...bindings.map((binding) => binding.interval[1]));
        return {
          ...copy(segment),
          id: createId(),
          start: at(frame, from),
          end: at(frame, to),
          lineage: { copiedFromSegmentId: segment.id, interval: [from, to] },
        };
      });
    floor.walls.push(replacement);
    face.wallId = replacement.id;
    wall.referenceFaceId = facesOfWall(floor, wall.id)[0]?.face.id || null;
  }
}

function mergeWalls(floor, reference, other, resolutions, createId) {
  if (reference.id === other.id) return reference;
  if (reference.segments.length !== 1 || other.segments.length !== 1)
    failOperation(
      'complex_wall_merge',
      'Join one pair of straight construction segments at a time.'
    );
  const a = reference.segments[0],
    b = other.segments[0];
  const frame = segmentFrame(a.start, a.end);
  const otherFrame = segmentFrame(b.start, b.end);
  if (
    Math.abs(dot(frame.normal, otherFrame.tangent)) > EPS ||
    Math.abs(project(frame, b.start).offset) > EPS
  )
    failOperation('unaligned_walls', 'The wall axes must align before joining.');
  const keys = new Set([...Object.keys(reference.overrides), ...Object.keys(other.overrides)]);
  for (const key of keys) {
    if (own(resolutions, key)) reference.overrides[key] = copy(resolutions[key]);
    else if (
      own(reference.overrides, key) &&
      own(other.overrides, key) &&
      !equalValue(reference.overrides[key], other.overrides[key])
    )
      failOperation(
        'conflicting_wall_properties',
        'Choose one value before joining the physical walls.',
        { type: 'wall', id: reference.id },
        { property: key, values: [reference.overrides[key], other.overrides[key]] }
      );
    else if (!own(reference.overrides, key)) reference.overrides[key] = copy(other.overrides[key]);
  }
  for (const [key, value] of Object.entries(resolutions || {})) {
    propertyKey(key);
    reference.overrides[key] = copy(value);
  }
  const projectedB = [project(frame, b.start).along, project(frame, b.end).along];
  const from = Math.min(0, ...projectedB),
    to = Math.max(frame.length, ...projectedB);
  if (Math.min(frame.length, Math.max(...projectedB)) < Math.max(0, Math.min(...projectedB)) - EPS)
    failOperation(
      'disconnected_walls',
      'Only touching or overlapping wall segments can be joined.'
    );
  if (!equalValue(a.overrides || {}, b.overrides || {})) {
    const overlap =
      Math.min(frame.length, Math.max(...projectedB)) - Math.max(0, Math.min(...projectedB));
    if (overlap > EPS)
      failOperation(
        'conflicting_construction_segments',
        'Overlapping construction segments require an explicit common property resolution.'
      );
    reference.segments.push(copy(b));
    reference.doors.push(...copy(other.doors));
    reference.windows.push(...copy(other.windows));
    reference.lineage = {
      ...(reference.lineage || {}),
      mergedWallIds: [...(reference.lineage?.mergedWallIds || []), other.id],
    };
    for (const room of floor.rooms)
      for (const face of room.faces) if (face.wallId === other.id) face.wallId = reference.id;
    for (const observation of floor.observations)
      if (observation.subject?.id === other.id) {
        observation.sourceSubject ||= copy(observation.subject);
        observation.subject.id = reference.id;
      }
    floor.walls = floor.walls.filter((wall) => wall.id !== other.id);
    return reference;
  }
  for (const collection of ['doors', 'windows']) {
    for (const opening of reference[collection]) opening.offset -= from;
    for (const opening of other[collection]) {
      const start = project(frame, at(otherFrame, opening.offset)).along;
      const end = project(frame, at(otherFrame, opening.offset + opening.width)).along;
      reference[collection].push({
        ...copy(opening),
        segmentId: a.id,
        offset: Math.min(start, end) - from,
      });
    }
  }
  a.start = at(frame, from);
  a.end = at(frame, to);
  reference.lineage = {
    ...(reference.lineage || {}),
    mergedWallIds: [...(reference.lineage?.mergedWallIds || []), other.id],
  };
  for (const room of floor.rooms)
    for (const face of room.faces) if (face.wallId === other.id) face.wallId = reference.id;
  for (const observation of floor.observations)
    if (observation.subject?.id === other.id || observation.subject?.id === b.id) {
      observation.sourceSubject ||= copy(observation.subject);
      observation.subject.id = observation.subject.id === b.id ? a.id : reference.id;
    }
  for (const observation of floor.observations)
    if (observation.relatedSubjects)
      observation.relatedSubjects = observation.relatedSubjects.map((subject) =>
        subject.id === other.id
          ? { ...subject, id: reference.id }
          : subject.id === b.id
            ? { ...subject, id: a.id }
            : subject
      );
  floor.walls = floor.walls.filter((wall) => wall.id !== other.id);
  return reference;
}

function bindFaces(floor, operation, createId, specifications) {
  const a = findFace(floor, operation.referenceFaceId);
  const b = findFace(floor, operation.faceId);
  if (a.room.id === b.room.id || a.face.freePath || b.face.freePath)
    failOperation('invalid_binding_request', 'Choose opposite faces of two different rooms.');
  if (a.wall.id === b.wall.id) return;
  const aBinding = a.face.bindings.find(
    (binding) => !operation.referenceEdgeId || binding.edgeId === operation.referenceEdgeId
  );
  const bBinding = b.face.bindings.find(
    (binding) => !operation.edgeId || binding.edgeId === operation.edgeId
  );
  if (!aBinding || !bBinding)
    failOperation('missing_binding', 'Both room-facing portions must have valid geometry.');
  const aEdge = polygonEdges(a.room).find((edge) => edge.id === aBinding.edgeId);
  const bEdge = polygonEdges(b.room).find((edge) => edge.id === bBinding.edgeId);
  if (dot(aEdge.tangent, bEdge.tangent) > -1 + EPS)
    failOperation(
      'opposite_faces_required',
      'Shared room boundaries must face in opposite directions.'
    );
  const thickness = own(operation.resolutions, 'wall_thickness_m')
    ? operation.resolutions.wall_thickness_m
    : a.wall.properties.wall_thickness_m;
  if (!Number.isFinite(thickness) || thickness <= 0)
    failOperation(
      'unknown_wall_thickness',
      'Choose a positive thickness before assembling shared room faces.'
    );
  const sign = Math.sign(polygonArea(a.room.vertices));
  const expected = -sign * thickness;
  const actual = project(aEdge, bEdge.start).offset;
  if (!near(actual, expected)) {
    if (!operation.align)
      failOperation(
        'face_gap_mismatch',
        'The gap between room faces differs from the selected thickness.',
        { type: 'wall', id: a.wall.id }
      );
    if (
      b.room.faces.some((face) =>
        facesOfWall(floor, face.wallId).some((entry) => entry.room.id !== b.room.id)
      )
    )
      failOperation(
        'connected_room_alignment',
        'Detach or explicitly move the connected room group before snapping this room.'
      );
    translateUnsharedRoom(floor, b.room, multiply(aEdge.normal, expected - actual));
  }
  const axis = a.wall.segments[0];
  const direction = segmentFrame(axis.start, axis.end);
  const side = aBinding.side;
  const currentHalf = (a.wall.properties.wall_thickness_m ?? thickness) / 2;
  const axisDelta = multiply(direction.normal, side * (currentHalf - thickness / 2));
  axis.start = add(axis.start, axisDelta);
  axis.end = add(axis.end, axisDelta);
  const bSegment = b.wall.segments[0];
  const frameB = segmentFrame(bSegment.start, bSegment.end);
  const target = project(segmentFrame(axis.start, axis.end), bSegment.start).offset;
  bSegment.start = add(bSegment.start, multiply(direction.normal, -target));
  bSegment.end = add(bSegment.end, multiply(direction.normal, -target));
  if (Math.abs(dot(frameB.tangent, direction.tangent)) < 1 - EPS)
    failOperation('unaligned_walls', 'Only parallel wall segments can be bound.');
  mergeWalls(floor, a.wall, b.wall, operation.resolutions || {}, createId);
  const conflicts = reconcileBuildingPlanProperties({ floors: [floor] }, specifications);
  if (conflicts.length) {
    const error = new Error(conflicts[0].message);
    error.issues = conflicts;
    throw error;
  }
  rebindBuildingPlanFaces(floor, createId);
}

function attachRoom(floor, room, operation, createId, specifications) {
  const tolerance = operation.attachmentTolerance ?? 0;
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 0.5)
    failOperation(
      'invalid_snap_tolerance',
      'Room attachment tolerance must be between zero and half a metre.'
    );
  for (const face of [...room.faces]) {
    if (face.freePath || facesOfWall(floor, face.wallId).some((entry) => entry.room.id !== room.id))
      continue;
    if (findWall(floor, face.wallId).lineage?.explicitPhysicalSeparation) continue;
    const edge = sourceEdges(room, face)[0];
    if (!edge) continue;
    const matches = [];
    for (const neighbour of floor.rooms.filter((entry) => entry.id !== room.id))
      for (const reference of neighbour.faces.filter((entry) => !entry.freePath)) {
        const wall = findWall(floor, reference.wallId);
        const thickness = wall.properties.wall_thickness_m;
        if (!Number.isFinite(thickness) || wall.lineage?.explicitPhysicalSeparation) continue;
        for (const otherEdge of sourceEdges(neighbour, reference)) {
          if (dot(edge.tangent, otherEdge.tangent) > -1 + EPS) continue;
          const gap = project(otherEdge, edge.start).offset;
          const expected = -Math.sign(polygonArea(neighbour.vertices)) * thickness;
          const extent = [
            project(otherEdge, edge.start).along,
            project(otherEdge, edge.end).along,
          ].sort((a, b) => a - b);
          if (
            Math.min(otherEdge.length, extent[1]) - Math.max(0, extent[0]) <= EPS ||
            Math.abs(gap - expected) > tolerance + EPS
          )
            continue;
          matches.push({
            referenceFaceId: reference.id,
            referenceEdgeId: otherEdge.id,
            mismatch: Math.abs(gap - expected),
          });
        }
      }
    matches.sort(
      (a, b) => a.mismatch - b.mismatch || a.referenceFaceId.localeCompare(b.referenceFaceId)
    );
    if (matches.length)
      bindFaces(
        floor,
        {
          ...matches[0],
          faceId: face.id,
          edgeId: edge.id,
          align: tolerance > 0,
          resolutions: operation.resolutions,
        },
        createId,
        specifications
      );
  }
}

function applyThicknessChanges(floor, before, activeRoomId, createId, operation = {}) {
  const changedEdges = [];
  for (const wall of floor.walls) {
    const oldWall = before.walls.find((entry) => entry.id === wall.id);
    if (!oldWall) continue;
    const linked = facesOfWall(before, wall.id);
    for (const segment of wall.segments) {
      const oldSegment = oldWall.segments.find((entry) => entry.id === segment.id);
      if (!oldSegment) continue;
      const oldThickness =
        buildingPlanSegmentThickness(oldWall, oldSegment) ?? (oldSegment.referenceOffset ?? 0) * 2;
      const nextThickness = buildingPlanSegmentThickness(wall, segment);
      if (nextThickness == null || near(oldThickness, nextThickness)) continue;
      if (!Number.isFinite(nextThickness) || nextThickness <= 0)
        failOperation(
          'invalid_dimension',
          'Wall thickness must be positive or explicitly unknown.'
        );
      const delta = nextThickness - oldThickness;
      segment.referenceOffset = nextThickness / 2;

      const candidates = linked.flatMap(({ room, face }) =>
        face.bindings
          .filter((binding) => binding.segmentId === segment.id)
          .map((binding) => ({ room, face, binding }))
      );
      const anchor =
        candidates.find((entry) => entry.room.id === activeRoomId) ||
        candidates.find((entry) => entry.face.id === wall.referenceFaceId) ||
        candidates[0];
      if (!anchor) continue;
      const frame = segmentFrame(oldSegment.start, oldSegment.end);
      const axisDelta = multiply(frame.normal, (-anchor.binding.side * delta) / 2);
      segment.start = cleanPoint(add(segment.start, axisDelta));
      segment.end = cleanPoint(add(segment.end, axisDelta));
      for (const other of candidates) {
        if (other.binding.side === anchor.binding.side) continue;
        const room = findRoom(floor, other.room.id);
        const edge = polygonEdges(room).find((entry) => entry.id === other.binding.edgeId);
        if (!edge)
          failOperation(
            'layout_constraint',
            'The thickness change conflicts with another changed boundary.'
          );
        shiftBoundEdge(
          room,
          edge.id,
          other.binding.roomInterval,
          multiply(frame.normal, -anchor.binding.side * delta),
          createId,
          changedEdges
        );
      }
    }
  }
  const affected = floor.walls.filter((entry) =>
    before.walls.some(
      (old) =>
        old.id === entry.id &&
        !equalValue(
          old.segments.map((segment) => buildingPlanSegmentThickness(old, segment)),
          entry.segments.map((segment) => buildingPlanSegmentThickness(entry, segment))
        )
    )
  );
  finishBoundaryEdit(floor, before, changedEdges, affected, operation, createId);
}

function removeWithObservations(floor, ids, allowObservationDeletion) {
  const observations = floor.observations.filter((entry) => ids.has(entry.subject?.id));
  if (observations.length && !allowObservationDeletion)
    failOperation(
      'observation_deletion_requires_confirmation',
      'This removal also deletes observations. Confirm the destructive cascade using the existing Remove confirmation.',
      null,
      { observationIds: observations.map((entry) => entry.id) }
    );
  floor.observations = floor.observations.filter((entry) => !ids.has(entry.subject?.id));
}

/** Mutates only a private session candidate. Public callers always receive copies. */
export function applyBuildingPlanOperation(
  snapshot,
  operation,
  { createId, specifications, editingPolicy = {} }
) {
  if (!operation || typeof operation.type !== 'string')
    failOperation('invalid_operation', 'A building-plan operation type is required.');
  operation = {
    ...operation,
    preserveWallGrouping:
      operation.preserveWallGrouping ?? editingPolicy.preserveWallGrouping ?? false,
  };
  if (typeof operation.preserveWallGrouping !== 'boolean')
    failOperation('invalid_editing_policy', 'preserveWallGrouping must be boolean.');
  if (operation.type === 'batch') {
    if (
      !Array.isArray(operation.operations) ||
      operation.operations.some((entry) => !entry || entry.type === 'batch')
    )
      failOperation('invalid_batch', 'A batch requires a flat list of operations.');
    const before = copy(snapshot);
    const propertyOperations = operation.operations.filter((entry) =>
      ['set_property', 'set_defaults'].includes(entry.type)
    );
    for (const entry of propertyOperations) {
      propertyKey(entry.property);
      const specification = specifications[entry.property];
      if (!specification || specification.scope === 'observation')
        failOperation('unknown_property', 'Choose a declared property.');
      const floor = findBuildingPlanFloor(snapshot, entry.floorId);
      let target;
      if (entry.type === 'set_defaults') {
        if (!specification.inherit)
          failOperation(
            'property_not_inheritable',
            'This property does not support inherited defaults.'
          );
        target = (entry.roomId ? findRoom(floor, entry.roomId) : floor).defaults;
      } else
        target =
          specification.scope === 'room_face'
            ? findFace(floor, entry.faceId).face
            : findWall(floor, entry.wallId);
      if (entry.type !== 'set_defaults') {
        if (entry.segmentId) {
          const segment = target.segments?.find((segment) => segment.id === entry.segmentId);
          if (!segment)
            failOperation('missing_segment', 'The construction segment no longer exists.');
          target = segment;
        }
        target = target.overrides ||= {};
      }
      if (entry.reset) delete target[entry.property];
      else target[entry.property] = copy(entry.value);
    }
    const issues = reconcileBuildingPlanProperties(snapshot, specifications);
    if (issues.length) {
      const error = new Error(issues[0].message);
      error.issues = issues;
      throw error;
    }
    for (const floor of snapshot.floors) {
      const old = before.floors.find((entry) => entry.id === floor.id);
      if (old)
        applyThicknessChanges(
          floor,
          old,
          operation.activeRoomId ||
            propertyOperations.find((entry) => entry.floorId === floor.id)?.activeRoomId,
          createId,
          operation
        );
    }
    const created = [];
    for (const entry of operation.operations.filter((item) => !propertyOperations.includes(item))) {
      const result = applyBuildingPlanOperation(snapshot, entry, {
        createId,
        specifications,
        editingPolicy: { ...editingPolicy, preserveWallGrouping: operation.preserveWallGrouping },
      });
      if (result.created) created.push(result.created);
    }
    return { createdSubjects: created };
  }
  if (operation.type === 'create_floor') {
    const floor = createBuildingPlanFloor({ ...operation, id: operation.id || createId() });
    snapshot.floors.push(floor);
    return { created: { type: 'floor', id: floor.id } };
  }
  const floor = findBuildingPlanFloor(snapshot, operation.floorId);
  switch (operation.type) {
    case 'create_room': {
      const room = createBuildingPlanRoom(floor, operation, createId, specifications);
      if (operation.attach) attachRoom(floor, room, operation, createId, specifications);
      return { created: { type: 'room', id: room.id } };
    }
    case 'create_wall': {
      const room = findRoom(floor, operation.roomId);
      if (!Array.isArray(operation.vertices) || operation.vertices.length < 2)
        failOperation('invalid_wall_geometry', 'Draw at least two distinct wall points.');
      const path = operation.vertices.map((p) => cleanPoint({ ...p, id: p.id || createId() }));
      const wall = {
        id: operation.id || createId(),
        overrides: copy(operation.overrides || {}),
        properties: {},
        provenance: {},
        values: copy(operation.values || {}),
        segments: [],
        doors: [],
        windows: [],
      };
      const face = {
        id: createId(),
        wallId: wall.id,
        overrides: {},
        values: {},
        bindings: [],
        freePath: path,
        freeEdges: path.slice(0, -1).map(() => createId()),
      };
      wall.referenceFaceId = face.id;
      floor.walls.push(wall);
      room.faces.push(face);
      reconcileBuildingPlanProperties(snapshot, specifications);
      const half = (wall.properties.wall_thickness_m ?? 0) / 2;
      wall.segments = path.slice(0, -1).map((start, i) => {
        const frame = segmentFrame(start, path[i + 1]);
        return {
          id: createId(),
          start: at(frame, 0, -half),
          end: at(frame, frame.length, -half),
          referenceOffset: half,
        };
      });
      rebindBuildingPlanFaces(floor, createId);
      return {
        created: { type: 'wall', id: wall.id },
        createdFace: { type: 'room_face', id: face.id },
      };
    }
    case 'bind_faces':
      bindFaces(floor, operation, createId, specifications);
      break;
    case 'join_walls':
      mergeWalls(
        floor,
        findWall(floor, operation.wallId),
        findWall(floor, operation.otherWallId),
        operation.resolutions || {},
        createId
      );
      break;
    case 'move_room': {
      const room = findRoom(floor, operation.roomId);
      detachRoom(floor, room, createId);
      translateUnsharedRoom(floor, room, operation.delta);
      if (operation.attach !== false) {
        rebindBuildingPlanFaces(floor, createId);
        attachRoom(floor, room, operation, createId, specifications);
      }
      break;
    }
    case 'resize_face':
      resizeFace(floor, operation, createId);
      break;
    case 'separate_wall': {
      const wall = findWall(floor, operation.wallId);
      if (
        operation.segmentIds &&
        (!Array.isArray(operation.segmentIds) ||
          !operation.segmentIds.length ||
          operation.segmentIds.some((id) => !wall.segments.some((segment) => segment.id === id)))
      )
        failOperation(
          'invalid_segment_selection',
          'Choose existing construction segments to separate.'
        );
      const created = separatePhysicalWallRuns(floor, wall, createId, operation.segmentIds);
      for (const part of [wall, ...created])
        part.lineage = { ...part.lineage, explicitPhysicalSeparation: true };
      rebindBuildingPlanFaces(floor, createId);
      reconcileBuildingPlanProperties(snapshot, specifications);
      return { createdSubjects: created.map((entry) => ({ type: 'wall', id: entry.id })) };
    }
    case 'resize_room': {
      const room = findRoom(floor, operation.roomId);
      const bounds = (vertices) => {
        const xs = vertices.map((p) => p.x),
          ys = vertices.map((p) => p.y);
        return {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        };
      };
      const old = bounds(room.vertices);
      const rectangle = operation.rectangle;
      if (
        !rectangle ||
        !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(rectangle[key])) ||
        rectangle.width <= EPS ||
        rectangle.height <= EPS
      )
        failOperation('invalid_rectangle', 'The room bounds must have positive finite dimensions.');
      const before = copy(floor);
      if (!facesOfWall(floor, room.faces[0]?.wallId).length) break;
      const shared = room.faces.some((face) =>
        facesOfWall(floor, face.wallId).some((entry) => entry.room.id !== room.id)
      );
      if (!shared) {
        room.vertices = room.vertices.map((p) =>
          cleanPoint({
            ...p,
            x: rectangle.x + ((p.x - old.x) * rectangle.width) / old.width,
            y: rectangle.y + ((p.y - old.y) * rectangle.height) / old.height,
          })
        );
        for (const face of room.faces)
          if (face.freePath)
            face.freePath = face.freePath.map((p) =>
              cleanPoint({
                ...p,
                x: rectangle.x + ((p.x - old.x) * rectangle.width) / old.width,
                y: rectangle.y + ((p.y - old.y) * rectangle.height) / old.height,
              })
            );
        repairUnsharedWalls(floor, before, createId);
      } else {
        const requested = [
          { axis: 'x', coordinate: old.x, delta: rectangle.x - old.x },
          {
            axis: 'x',
            coordinate: old.x + old.width,
            delta: rectangle.x + rectangle.width - old.x - old.width,
          },
          { axis: 'y', coordinate: old.y, delta: rectangle.y - old.y },
          {
            axis: 'y',
            coordinate: old.y + old.height,
            delta: rectangle.y + rectangle.height - old.y - old.height,
          },
        ];
        for (const change of requested.filter((entry) => Math.abs(entry.delta) > EPS)) {
          const currentRoom = findRoom(floor, room.id);
          const edge = polygonEdges(currentRoom).find(
            (entry) =>
              near(entry.start[change.axis], change.coordinate) &&
              near(entry.end[change.axis], change.coordinate)
          );
          const face = currentRoom.faces.find((entry) =>
            entry.bindings.some((binding) => binding.edgeId === edge?.id)
          );
          if (!edge || !face)
            failOperation(
              'ambiguous_room_resize',
              'Use a specific face handle to resize this non-rectangular room.'
            );
          const vector =
            change.axis === 'x' ? { x: change.delta, y: 0 } : { x: 0, y: change.delta };
          resizeFace(
            floor,
            {
              faceId: face.id,
              edgeId: edge.id,
              distance: -Math.sign(polygonArea(currentRoom.vertices)) * dot(vector, edge.normal),
              preserveWallGrouping: operation.preserveWallGrouping,
            },
            createId
          );
        }
      }
      break;
    }
    case 'update_wall': {
      const wall = findWall(floor, operation.wallId);
      const linked = facesOfWall(floor, wall.id);
      if (linked.length !== 1 || !linked[0].face.freePath)
        failOperation(
          'wall_boundary_edit_required',
          'Edit a boundary wall using its room-facing edge.'
        );
      const { face } = linked[0];
      if (!Array.isArray(operation.vertices) || operation.vertices.length !== face.freePath.length)
        failOperation(
          'wall_topology_edit_required',
          'Use split/join operations to change the number of wall segments.'
        );
      const half = (wall.properties.wall_thickness_m ?? 0) / 2;
      const previous = copy(wall.segments);
      face.freePath = operation.vertices.map((p, index) =>
        cleanPoint({ ...p, id: face.freePath[index].id })
      );
      wall.segments = face.freePath.slice(0, -1).map((start, index) => {
        const frame = segmentFrame(start, face.freePath[index + 1]);
        return {
          ...wall.segments[index],
          start: at(frame, 0, -half),
          end: at(frame, frame.length, -half),
        };
      });
      for (const opening of [...wall.doors, ...wall.windows]) {
        const oldSegment = previous.find((segment) => segment.id === opening.segmentId);
        const segment = wall.segments.find((entry) => entry.id === opening.segmentId);
        remapOpeningForSegment(opening, oldSegment, segment, operation.anchor);
      }
      break;
    }
    case 'split_wall': {
      const wall = findWall(floor, operation.wallId);
      if (wall.segments.length !== 1)
        failOperation('complex_wall_split', 'Split one straight construction segment at a time.');
      const segment = wall.segments[0],
        frame = segmentFrame(segment.start, segment.end);
      const cut = operation.offset;
      if (!Number.isFinite(cut) || cut <= EPS || cut >= frame.length - EPS)
        failOperation('invalid_split', 'Choose an interior wall position.');
      for (const opening of [...wall.doors, ...wall.windows])
        if (opening.offset < cut - EPS && opening.offset + opening.width > cut + EPS)
          failOperation(
            'opening_crosses_split',
            'The construction split passes through an opening.'
          );
      const other = {
        ...copy(wall),
        id: operation.newWallId || createId(),
        overrides: { ...copy(wall.overrides), ...copy(operation.overrides || {}) },
        doors: [],
        windows: [],
        segments: [
          { ...copy(segment), id: createId(), start: at(frame, cut), end: at(frame, frame.length) },
        ],
        lineage: { splitFromWallId: wall.id, interval: [cut, frame.length] },
      };
      segment.end = at(frame, cut);
      wall.lineage = {
        ...(wall.lineage || {}),
        splitWallIds: [...(wall.lineage?.splitWallIds || []), other.id],
      };
      floor.walls.push(other);
      for (const room of floor.rooms) {
        for (const face of [...room.faces.filter((entry) => entry.wallId === wall.id)]) {
          const intervals = face.bindings
            .filter((entry) => entry.segmentId === segment.id)
            .map((entry) => entry.interval);
          const left = intervals.some((range) => range[0] < cut - EPS),
            right = intervals.some((range) => range[1] > cut + EPS);
          if (left && right) {
            for (const binding of face.bindings.filter(
              (entry) =>
                entry.segmentId === segment.id &&
                entry.interval[0] < cut - EPS &&
                entry.interval[1] > cut + EPS
            )) {
              const edge = polygonEdges(room).find((entry) => entry.id === binding.edgeId);
              const point = at(
                frame,
                cut,
                (binding.side * (wall.properties.wall_thickness_m ?? 0)) / 2
              );
              const index = room.vertices.findIndex((entry) => entry.id === edge.start.id);
              const vertex = { ...point, id: createId() };
              const previous = room.edges;
              room.vertices.splice(index + 1, 0, vertex);
              assignRoomEdges(room, createId, previous);
              const replacement = room.edges
                .filter((entry) => entry.startId === edge.start.id || entry.startId === vertex.id)
                .map((entry) => entry.id);
              for (const portion of room.faces)
                if (portion.edgeIds?.includes(edge.id))
                  portion.edgeIds = portion.edgeIds.flatMap((id) =>
                    id === edge.id ? replacement : [id]
                  );
            }
            const edges = sourceEdges(room, face);
            const leftEdges = edges
              .filter((edge) => project(frame, at(edge, edge.length / 2)).along < cut + EPS)
              .map((edge) => edge.id);
            const rightEdges = edges
              .filter((edge) => project(frame, at(edge, edge.length / 2)).along > cut - EPS)
              .map((edge) => edge.id);
            room.faces.push({
              ...copy(face),
              id: createId(),
              wallId: other.id,
              edgeIds: rightEdges,
              bindings: [],
              lineage: { splitFromFaceId: face.id },
            });
            face.edgeIds = leftEdges;
          } else if (right) face.wallId = other.id;
        }
      }
      for (const collection of ['doors', 'windows']) {
        for (const opening of wall[collection].filter((entry) => entry.offset >= cut - EPS))
          other[collection].push({
            ...copy(opening),
            offset: opening.offset - cut,
            segmentId: other.segments[0].id,
          });
        wall[collection] = wall[collection].filter((entry) => entry.offset < cut - EPS);
      }
      other.referenceFaceId = facesOfWall(floor, other.id)[0]?.face.id || null;
      wall.referenceFaceId = facesOfWall(floor, wall.id)[0]?.face.id || null;
      break;
    }
    case 'resize_preserve_group': {
      if (!Array.isArray(operation.affectedRoomIds) || !operation.affectedRoomIds.length)
        failOperation('affected_group_required', 'Explicitly identify the affected room group.');
      const before = copy(floor);
      resizeFace(floor, operation, createId);
      const selected = new Set(operation.preserveRoomIds || []);
      const queue = [...selected];
      const moved = new Set();
      for (const roomId of queue) {
        if (moved.has(roomId)) continue;
        const room = findRoom(floor, roomId),
          oldRoom = findRoom(before, roomId);
        const changed = room.vertices.find((p) => {
          const old = oldRoom.vertices.find((entry) => entry.id === p.id);
          return old && distance(p, old) > EPS;
        });
        if (!changed) continue;
        const oldVertex = oldRoom.vertices.find((p) => p.id === changed.id);
        const delta = subtract(changed, oldVertex);
        if (room.vertices.length !== oldRoom.vertices.length)
          failOperation(
            'group_requires_whole_face',
            'Size-preserving group edits require a complete shared face.'
          );
        for (const face of oldRoom.faces)
          for (const binding of face.bindings) {
            const edge = polygonEdges(oldRoom).find((entry) => entry.id === binding.edgeId);
            const currentEdge = polygonEdges(room).find((entry) => entry.id === binding.edgeId);
            if (
              !edge ||
              !currentEdge ||
              (distance(currentEdge.start, add(edge.start, delta)) <= EPS &&
                distance(currentEdge.end, add(edge.end, delta)) <= EPS)
            )
              continue;
            const outward = -Math.sign(polygonArea(oldRoom.vertices)) * dot(delta, edge.normal);
            if (Math.abs(outward) > EPS)
              resizeFace(floor, { faceId: face.id, edgeId: edge.id, distance: outward }, createId);
          }
        room.vertices = oldRoom.vertices.map((p) => cleanPoint({ ...p, ...add(p, delta) }));
        moved.add(roomId);
      }
      const allowed = new Set(operation.affectedRoomIds);
      const outside = floor.rooms.filter(
        (room) =>
          !allowed.has(room.id) && !equalValue(room.vertices, findRoom(before, room.id).vertices)
      );
      if (outside.length)
        failOperation(
          'outside_affected_group',
          'The operation would change rooms outside the supplied group.',
          null,
          { roomIds: outside.map((room) => room.id) }
        );
      repairUnsharedWalls(floor, before, createId);
      break;
    }
    case 'set_property':
    case 'set_defaults': {
      const before = copy(floor);
      propertyKey(operation.property);
      const specification = specifications[operation.property];
      if (!specification || specification.scope === 'observation')
        failOperation('unknown_property', 'Choose a declared inheritable property.');
      if (operation.type === 'set_property') {
        let subject =
          specification.scope === 'room_face'
            ? findFace(floor, operation.faceId).face
            : findWall(floor, operation.wallId);
        if (operation.segmentId) {
          subject = subject.segments?.find((segment) => segment.id === operation.segmentId);
          if (!subject)
            failOperation('missing_segment', 'The construction segment no longer exists.');
        }
        subject.overrides ||= {};
        if (operation.reset) delete subject.overrides[operation.property];
        else subject.overrides[operation.property] = copy(operation.value);
      } else {
        if (!specification.inherit)
          failOperation(
            'property_not_inheritable',
            'This property does not support inherited defaults.'
          );
        const subject = operation.roomId ? findRoom(floor, operation.roomId) : floor;
        if (operation.reset) delete subject.defaults[operation.property];
        else subject.defaults[operation.property] = copy(operation.value);
      }
      const conflicts = reconcileBuildingPlanProperties(snapshot, specifications);
      if (conflicts.length) {
        const error = new Error(conflicts[0].message);
        error.issues = conflicts;
        throw error;
      }
      applyThicknessChanges(
        floor,
        before,
        operation.activeRoomId || operation.roomId,
        createId,
        operation
      );
      break;
    }
    case 'set_values': {
      const subject = operation.faceId
        ? findFace(floor, operation.faceId).face
        : operation.wallId
          ? findWall(floor, operation.wallId)
          : operation.roomId
            ? findRoom(floor, operation.roomId)
            : floor;
      for (const [key, value] of Object.entries(operation.values || {})) {
        propertyKey(key);
        subject.values[key] = copy(value);
      }
      break;
    }
    case 'create_opening': {
      const wall = findWall(floor, operation.wallId);
      if (!['door', 'window'].includes(operation.kind))
        failOperation('invalid_opening_type', 'Choose a door or a window.');
      const opening = {
        id: operation.id || createId(),
        type: operation.kind,
        segmentId: operation.segmentId || wall.segments[0]?.id,
        offset: operation.offset,
        width: operation.width,
        height: operation.height ?? null,
        sillHeight: operation.sillHeight ?? null,
        values: copy(operation.values || {}),
      };
      wall[operation.kind === 'door' ? 'doors' : 'windows'].push(opening);
      return { created: { type: opening.type, id: opening.id } };
    }
    case 'update_opening':
    case 'remove_opening': {
      const wall = findWall(floor, operation.wallId);
      const opening = [...wall.doors, ...wall.windows].find(
        (entry) => entry.id === operation.openingId
      );
      if (!opening) failOperation('missing_opening', 'The opening no longer exists.');
      if (operation.type === 'remove_opening') {
        removeWithObservations(floor, new Set([opening.id]), operation.allowObservationDeletion);
        wall[opening.type === 'door' ? 'doors' : 'windows'] = wall[
          opening.type === 'door' ? 'doors' : 'windows'
        ].filter((entry) => entry.id !== opening.id);
      } else
        for (const key of ['offset', 'width', 'height', 'sillHeight', 'segmentId', 'values'])
          if (own(operation, key)) opening[key] = copy(operation[key]);
      break;
    }
    case 'add_observation': {
      const subject = operation.subject;
      const wall = floor.walls.find((entry) => entry.id === subject?.id);
      const room = floor.rooms.find((entry) => entry.id === subject?.id);
      const constructionSegment = floor.walls
        .flatMap((entry) => entry.segments)
        .find((entry) => entry.id === subject?.id);
      const facing = floor.rooms
        .flatMap((room) => room.faces.map((face) => ({ room, face })))
        .find(({ face }) => face.id === subject?.id);
      const context = constructionSegment
        ? { basis: 'accepted_layout', segments: [copy(constructionSegment)] }
        : wall
          ? { basis: 'accepted_layout', segments: copy(wall.segments) }
          : room
            ? { basis: 'accepted_layout', vertices: copy(room.vertices) }
            : facing
              ? {
                  basis: 'accepted_layout',
                  portions: buildingPlanFaceSegments(floor, facing.room, facing.face),
                }
              : null;
      const observation = {
        id: operation.id || createId(),
        subject: copy(operation.subject),
        observedAt: operation.observedAt ?? null,
        coverage: copy(operation.coverage ?? null),
        method: operation.method ?? null,
        evidence: copy(operation.evidence || []),
        values: copy(operation.values || {}),
        sourceSubject: copy(subject),
        sourceGeometry: copy(operation.sourceGeometry ?? context),
      };
      floor.observations.push(observation);
      return { created: { type: 'observation', id: observation.id } };
    }
    case 'update_observation':
    case 'remove_observation': {
      const observation = floor.observations.find((entry) => entry.id === operation.observationId);
      if (!observation) failOperation('missing_observation', 'The observation no longer exists.');
      if (operation.type === 'remove_observation')
        floor.observations = floor.observations.filter((entry) => entry !== observation);
      else
        for (const key of ['observedAt', 'coverage', 'method', 'evidence', 'values'])
          if (own(operation, key)) observation[key] = copy(operation[key]);
      break;
    }
    case 'remove_face': {
      const { room, face, wall } = findFace(floor, operation.faceId);
      const ids = new Set([face.id]);
      const exclusive = facesOfWall(floor, wall.id).length === 1;
      if (exclusive)
        for (const id of [
          wall.id,
          ...wall.doors.map((entry) => entry.id),
          ...wall.windows.map((entry) => entry.id),
        ])
          ids.add(id);
      removeWithObservations(floor, ids, operation.allowObservationDeletion);
      room.faces = room.faces.filter((entry) => entry.id !== face.id);
      if (exclusive) floor.walls = floor.walls.filter((entry) => entry.id !== wall.id);
      else if (wall.referenceFaceId === face.id)
        wall.referenceFaceId = facesOfWall(floor, wall.id)[0]?.face.id || null;
      break;
    }
    case 'remove_floor': {
      if (floor.observations.length && !operation.allowObservationDeletion)
        failOperation(
          'observation_deletion_requires_confirmation',
          'Removing this floor deletes its survey observations.'
        );
      snapshot.floors = snapshot.floors.filter((entry) => entry.id !== floor.id);
      break;
    }
    case 'remove_room': {
      const room = findRoom(floor, operation.roomId);
      const ids = new Set([
        room.id,
        ...room.faces.map((face) => face.id),
        ...['columns', 'beams', 'objects'].flatMap((kind) => room[kind].map((entry) => entry.id)),
      ]);
      const exclusive = floor.walls.filter((wall) =>
        facesOfWall(floor, wall.id).every((entry) => entry.room.id === room.id)
      );
      for (const wall of exclusive)
        for (const id of [
          wall.id,
          ...wall.doors.map((entry) => entry.id),
          ...wall.windows.map((entry) => entry.id),
        ])
          ids.add(id);
      removeWithObservations(floor, ids, operation.allowObservationDeletion);
      floor.rooms = floor.rooms.filter((entry) => entry.id !== room.id);
      floor.walls = floor.walls.filter((entry) => !exclusive.includes(entry));
      for (const wall of floor.walls)
        if (room.faces.some((face) => face.id === wall.referenceFaceId))
          wall.referenceFaceId = facesOfWall(floor, wall.id)[0]?.face.id || null;
      break;
    }
    case 'create_element':
    case 'update_element':
    case 'remove_element': {
      const room = findRoom(floor, operation.roomId);
      if (!['columns', 'beams', 'objects'].includes(operation.collection))
        failOperation('unknown_collection', 'Choose a supported room element collection.');
      const list = room[operation.collection];
      if (operation.type === 'create_element') {
        const item = {
          id: operation.id || createId(),
          ...copy(operation.element || {}),
          values: copy(operation.values || {}),
        };
        list.push(item);
        return { created: { type: operation.collection, id: item.id } };
      }
      const item = list.find((entry) => entry.id === operation.elementId);
      if (!item) failOperation('missing_element', 'The room element no longer exists.');
      if (operation.type === 'remove_element') {
        removeWithObservations(floor, new Set([item.id]), operation.allowObservationDeletion);
        room[operation.collection] = list.filter((entry) => entry !== item);
      } else Object.assign(item, copy(operation.element || {}), { id: item.id });
      break;
    }
    default:
      failOperation('unknown_operation', `Unsupported building-plan operation: ${operation.type}`);
  }
  if (['resize_face', 'resize_room', 'set_property', 'set_defaults'].includes(operation.type))
    for (const room of floor.rooms)
      attachRoom(floor, room, { ...operation, attachmentTolerance: 0 }, createId, specifications);
  const conflicts = reconcileBuildingPlanProperties(snapshot, specifications);
  if (conflicts.length) {
    const error = new Error(conflicts[0].message);
    error.issues = conflicts;
    throw error;
  }
  rebindBuildingPlanFaces(floor, createId);
  return {};
}
