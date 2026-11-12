import { renewBuildingPlanRowIdentities } from './custom-rows.js';
import { materializeBuildingPlanProfiles } from './material-profiles.js';
import { buildingPlanEditingCutStations } from './wall-divisions.js';
import { mergeWalls } from './wall-merge.js';
import { isolateBuildingPlanContact } from './physical-pieces.js';
import { attachmentSeatingDelta } from './attachment-seating.js';
import { createWallSides } from './wall-sides.js';
import { propertySpecification, resolveInheritedProperty } from './inheritance.js';
import { repairSharedWallExtents } from './boundary-edits.js';
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
import { reconcileWallExtents } from './wall-extents.js';
import { rejoinEditingCut, splitEditingFace } from './editing-cuts.js';
import { movePartitionPortion } from './partition-edits.js';

import { reshapeBuildingPlanAxes, reshapeBuildingPlanAxisThickness } from './axis-edits.js';
import { completeThicknessCorners } from './corner-profiles.js';
import { reshapeBuildingPlanBoundary } from './junction-edits.js';
import { applyProperty, operationSubject, propertyKey } from './property-edits.js';
import { applyOpeningOperation } from './opening-operations.js';

export function failOperation(code, message, subject = null, details = {}) {
  const error = new Error(message);
  error.issues = [planIssue(code, message, subject, details)];
  throw error;
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
  const translated = new Set();
  for (const face of room.faces) {
    const wall = findWall(floor, face.wallId);
    if (facesOfWall(floor, wall.id).some((entry) => entry.room.id !== room.id))
      failOperation(
        'shared_move_requires_detach',
        'Moving this room requires detaching its shared walls.'
      );
    if (!translated.has(wall.id)) {
      for (const segment of wall.segments) {
        segment.start = cleanPoint(add(segment.start, delta));
        segment.end = cleanPoint(add(segment.end, delta));
      }
      translated.add(wall.id);
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
function repairUnsharedWalls(floor, before, createId, transformed = new Set()) {
  for (const wall of floor.walls) {
    const linked = facesOfWall(floor, wall.id);
    for (const { room, face } of linked) {
      const oldRoom = before.rooms.find((entry) => entry.id === room.id);
      const oldFace = oldRoom?.faces.find((entry) => entry.id === face.id);
      const oldWall = before.walls.find((entry) => entry.id === wall.id);
      if (!oldFace || !oldWall) continue;
      const edges = sourceEdges(room, face);
      for (const binding of oldFace.bindings) {
        if (transformed.has(binding.segmentId)) continue;
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
      ...copy(segment),
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
    const offsetField = `${opening.type}_offset_m`;
    if (own(opening.values, offsetField)) opening.values[offsetField] = opening.offset;
  }
  const index = wall.segments.indexOf(segment);
  wall.segments.splice(index, 1, ...pieces);
}

function addJogGeometry(floor, wall, changedEdges, createId, thicknessProfile = false) {
  rebindBuildingPlanFaces(floor, createId);
  for (const { roomId } of changedEdges) {
    const room = findRoom(floor, roomId);
    const faces = room.faces.filter((entry) => entry.wallId === wall.id && !entry.freePath);
    if (!faces.length) continue;
    const side = Math.sign(polygonArea(room.vertices));
    const half = (wall.properties.wall_thickness_m ?? 0) / 2;
    // Normalization can replace a temporary connector's edge identity or reverse
    // its room-facing side. Rebuild only the extents declared by this owner,
    // including those replacement edges, from the accepted room orientation.
    for (const edge of polygonEdges(room).filter(
      (entry) =>
        faces.some((face) => face.edgeIds?.includes(entry.id)) &&
        !faces.some((face) => face.bindings.some((binding) => binding.edgeId === entry.id))
    )) {
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
        ...(thicknessProfile ? { thicknessProfile: true } : {}),
      });
    }
  }
  rebindBuildingPlanFaces(floor, createId);
}

function resizeFace(floor, operation, createId, specifications) {
  const edit = reshapeBuildingPlanAxes(floor, { ...operation, type: 'resize_face' }, createId);
  finishBoundaryEdit(
    floor,
    edit.before,
    edit.changedEdges,
    edit.affectedWalls,
    {
      ...operation,
      type: 'resize_face',
      activeRoomId: edit.activeRoomId,
      transformedSegments: edit.transformed,
    },
    createId,
    specifications,
    edit.fittedRoomIds
  );
}

function finishBoundaryEdit(
  floor,
  before,
  changedEdges,
  affectedWalls,
  operation,
  createId,
  specifications,
  fittedRoomIds = [],
  thicknessProfile = false
) {
  if (!changedEdges.length && !affectedWalls.length) return;
  // A thickness update can move both sides of an explicit cut in one operation.
  // Remove its temporary zero-length return before resolving new facing contacts.
  for (const roomId of new Set(changedEdges.map((entry) => entry.roomId))) {
    const room = findRoom(floor, roomId);
    if (
      room.vertices.some(
        (point, index) => distance(point, room.vertices[(index + 1) % room.vertices.length]) <= EPS
      )
    )
      normalizeRoomBoundary(floor, room, createId);
  }
  const alignedRooms = new Set(
    changedEdges
      .filter((change) => change.roomId !== operation.activeRoomId)
      .map((change) => change.roomId)
  );
  for (const roomId of new Set(changedEdges.map((entry) => entry.roomId)))
    normalizeRoomBoundary(floor, findRoom(floor, roomId), createId);
  if (thicknessProfile) {
    const completed = completeThicknessCorners(
      floor,
      before,
      new Set(affectedWalls.map((wall) => wall.id)),
      createId
    );
    for (const roomId of completed) {
      const room = findRoom(floor, roomId);
      normalizeRoomBoundary(floor, room, createId);
      const change = changedEdges.find((entry) => entry.roomId === roomId);
      if (change)
        change.edgeIds = [...new Set([...change.edgeIds, ...room.edges.map((edge) => edge.id)])];
      else changedEdges.push({ roomId, edgeIds: room.edges.map((edge) => edge.id) });
    }
  }
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
  repairUnsharedWalls(floor, before, createId, operation.transformedSegments);
  repairSharedWallExtents(floor, before);
  reconcileWallExtents(floor, new Set(affectedWalls.map((wall) => wall.id)));
  rebindBuildingPlanFaces(floor, createId);
  for (const { roomId } of changedEdges) {
    const room = findRoom(floor, roomId);
    for (const face of room.faces) {
      if (
        face.freePath ||
        !face.edgeIds.some((id) => !face.bindings.some((binding) => binding.edgeId === id))
      )
        continue;
      const wall = findWall(floor, face.wallId);
      if (!affectedWalls.includes(wall)) affectedWalls.push(wall);
    }
  }
  for (const wall of affectedWalls)
    addJogGeometry(floor, wall, changedEdges, createId, thicknessProfile);
  reconcileWallExtents(floor, new Set(affectedWalls.map((wall) => wall.id)));
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
  pruneAutomaticReturns(floor, before);
  // Version-2 owner coalescence is performed after adjacency and answer compatibility
  // have been reconciled; geometric lineage alone cannot join physical subjects.
  coalesceAutomaticSegments(floor);
  coalesceFacingRows(floor);
  for (const wall of affectedWalls.filter(
    (wall) => floor.walls.includes(wall) && wall.segments.length > 1
  )) {
    wall.lineage = { ...wall.lineage, jogOriginWallId: wallTopologyOrigin(wall) };
  }
  splitFacingRows(floor, createId, new Map(), new Set(affectedWalls.map((wall) => wall.id)));
  rebindBuildingPlanFaces(floor, createId);
  // Attach only the newly aligned neighbour first, retaining the active room's existing
  // physical subject. Ordinary later wall contacts keep their usual stationary ownership.
  for (const roomId of alignedRooms)
    attachRoom(
      floor,
      findRoom(floor, roomId),
      { ...operation, attachmentTolerance: 0 },
      createId,
      specifications
    );
  for (const roomId of fittedRoomIds)
    attachRoom(
      floor,
      findRoom(floor, roomId),
      { ...operation, attachmentTolerance: 0 },
      createId,
      specifications
    );
}

function detachRoom(floor, room, createId) {
  const stationaryWalls = new Set();
  const replacements = new Map();
  for (const face of room.faces) {
    const wall = findWall(floor, face.wallId);
    if (!facesOfWall(floor, wall.id).some((entry) => entry.room.id !== room.id)) continue;
    if (replacements.has(wall.id)) {
      face.wallId = replacements.get(wall.id).id;
      continue;
    }
    const roomBindings = room.faces
      .filter((entry) => entry.wallId === wall.id)
      .flatMap((entry) => entry.bindings);
    const replacement = {
      ...copy(wall),
      id: createId(),
      referenceFaceId: face.id,
      overrides: copy(wall.overrides),
      sides: wall.sides.map((side) => ({
        ...copy(side),
        id: createId(),
        roomId: side.roomId === room.id ? room.id : null,
      })),
      doors: [],
      windows: [],
      lineage: {
        ...copy(wall.lineage || {}),
        copiedFromWallId: wall.id,
        dividedFromWallId: wall.id,
        reason: 'room_detach',
      },
    };
    renewBuildingPlanRowIdentities(replacement, createId);
    for (const side of replacement.sides) renewBuildingPlanRowIdentities(side, createId);
    replacement.segments = wall.segments
      .filter((segment) => roomBindings.some((binding) => binding.segmentId === segment.id))
      .map((segment) => {
        const bindings = roomBindings.filter((binding) => binding.segmentId === segment.id);
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
    replacements.set(wall.id, replacement);
    face.wallId = replacement.id;
    stationaryWalls.add(wall.id);
    wall.referenceFaceId = facesOfWall(floor, wall.id)[0]?.face.id || null;
  }
  const copiedCuts = new Map();
  for (const wallId of stationaryWalls) {
    const wall = findWall(floor, wallId);
    wall.referenceFaceId = facesOfWall(floor, wallId)[0]?.face.id || null;
  }
  for (const point of [...room.vertices, ...room.faces.flatMap((face) => face.freePath || [])]) {
    if (
      !point.editingCutId ||
      !floor.rooms.some(
        (other) =>
          other !== room &&
          [...other.vertices, ...other.faces.flatMap((face) => face.freePath || [])].some(
            (v) => v.editingCutId === point.editingCutId
          )
      )
    )
      continue;
    if (!copiedCuts.has(point.editingCutId)) copiedCuts.set(point.editingCutId, createId());
    point.editingCutId = copiedCuts.get(point.editingCutId);
  }
  reconcileWallExtents(floor, stationaryWalls, { retireUnbound: true });
}

function mergeBoundSegments(floor, reference, other, referenceId, otherId, resolutions, createId) {
  if (reference.segments.length === 1 && other.segments.length === 1)
    return mergeWalls(floor, reference, other, resolutions, createId);
  // Temporary axis runs can still belong to one planning subject. Separate
  // them before binding so the joined span cannot take ownership of unrelated
  // runs with different accepted thicknesses or custom answers.
  if (reference.segments.length > 1) separatePhysicalWallRuns(floor, reference, createId);
  if (other.segments.length > 1) separatePhysicalWallRuns(floor, other, createId);
  const a = floor.walls.find((wall) => wall.segments.some((segment) => segment.id === referenceId));
  const b = floor.walls.find((wall) => wall.segments.some((segment) => segment.id === otherId));
  return mergeWalls(floor, a, b, resolutions, createId);
}

/** Rejoin only automatic divisions of the same original straight construction. */
function coalesceAutomaticSegments(floor) {
  for (const wall of floor.walls) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const initial of wall.segments) {
        let a = initial;
        if (!a.lineage?.segmentId && !a.junction) continue;
        let frame = segmentFrame(a.start, a.end);
        let b = wall.segments.find(
          (segment) =>
            segment !== a &&
            ((a.junction && segment.junction) ||
              (a.lineage?.segmentId && segment.lineage?.segmentId === a.lineage.segmentId)) &&
            equalValue(segment.overrides || {}, a.overrides || {}) &&
            Math.abs(dot(frame.normal, segmentFrame(segment.start, segment.end).tangent)) <= EPS &&
            Math.abs(project(frame, segment.start).offset) <= EPS &&
            Math.min(
              frame.length,
              Math.max(project(frame, segment.start).along, project(frame, segment.end).along)
            ) >=
              Math.max(
                0,
                Math.min(project(frame, segment.start).along, project(frame, segment.end).along)
              ) -
                EPS
        );
        if (!b) continue;
        if (b.id === b.lineage?.segmentId && a.id !== a.lineage?.segmentId) {
          [a, b] = [b, a];
          frame = segmentFrame(a.start, a.end);
        }
        const other = segmentFrame(b.start, b.end),
          positions = [project(frame, b.start).along, project(frame, b.end).along];
        const from = Math.min(0, ...positions),
          to = Math.max(frame.length, ...positions);
        for (const opening of [...wall.doors, ...wall.windows]) {
          if (opening.segmentId === a.id) opening.offset -= from;
          else if (opening.segmentId === b.id) {
            const start = project(frame, at(other, opening.offset)).along,
              end = project(frame, at(other, opening.offset + opening.width)).along;
            opening.segmentId = a.id;
            opening.offset = Math.min(start, end) - from;
          }
        }

        a.start = at(frame, from);
        a.end = at(frame, to);
        a.lineage = {
          ...a.lineage,
          mergedSegmentIds: [...(a.lineage?.mergedSegmentIds || []), b.id],
        };
        wall.segments = wall.segments.filter((segment) => segment !== b);
        changed = true;
        break;
      }
    }
  }
}

function bindFaces(floor, operation, createId, specifications, contactThickness = null) {
  let a = findFace(floor, operation.referenceFaceId);
  let b = findFace(floor, operation.faceId);
  if (a.room.id === b.room.id || a.face.freePath || b.face.freePath)
    failOperation('invalid_binding_request', 'Choose opposite faces of two different rooms.');
  if (a.wall.id === b.wall.id) return;
  let aBinding = a.face.bindings.find(
    (binding) => !operation.referenceEdgeId || binding.edgeId === operation.referenceEdgeId
  );
  let bBinding = b.face.bindings.find(
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
  const thickness =
    contactThickness ??
    (own(operation.resolutions, 'wall_thickness_m')
      ? operation.resolutions.wall_thickness_m
      : a.wall.properties.wall_thickness_m);
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
  const referenceAxis = a.wall.segments.find((segment) => segment.id === aBinding.segmentId);
  const otherAxis = b.wall.segments.find((segment) => segment.id === bBinding.segmentId);
  const referenceFrame = segmentFrame(referenceAxis.start, referenceAxis.end);
  const changesReferenceWidth =
    Math.abs((a.wall.properties.wall_thickness_m ?? thickness) - thickness) > EPS;
  const hasTemporaryRuns = a.wall.segments.length > 1 || b.wall.segments.length > 1;
  // A generated cap can share its planning subject with a long stationary run.
  // Resolve the contacted extent before fitting the width or an offset run;
  // otherwise the fit moves construction outside that contact and loses bindings.
  if (
    changesReferenceWidth ||
    (hasTemporaryRuns && Math.abs(project(referenceFrame, otherAxis.start).offset) > EPS)
  ) {
    a = isolateBuildingPlanContact(floor, a, aBinding.segmentId, bEdge, createId);
    b = isolateBuildingPlanContact(floor, b, bBinding.segmentId, aEdge, createId);
    aBinding = a.face.bindings.find((binding) => binding.segmentId === a.contactSegmentId);
    bBinding = b.face.bindings.find((binding) => binding.segmentId === b.contactSegmentId);
  }
  const axis = a.wall.segments.find((segment) => segment.id === aBinding.segmentId);
  const direction = segmentFrame(axis.start, axis.end);
  const side = aBinding.side;
  const currentHalf = (a.wall.properties.wall_thickness_m ?? thickness) / 2;
  const axisDelta = multiply(direction.normal, side * (currentHalf - thickness / 2));
  axis.start = add(axis.start, axisDelta);
  axis.end = add(axis.end, axisDelta);
  const bSegment = b.wall.segments.find((segment) => segment.id === bBinding.segmentId);
  const frameB = segmentFrame(bSegment.start, bSegment.end);
  const target = project(segmentFrame(axis.start, axis.end), bSegment.start).offset;
  bSegment.start = add(bSegment.start, multiply(direction.normal, -target));
  bSegment.end = add(bSegment.end, multiply(direction.normal, -target));
  if (Math.abs(dot(frameB.tangent, direction.tangent)) < 1 - EPS)
    failOperation('unaligned_walls', 'Only parallel wall segments can be bound.');
  const merged = mergeBoundSegments(
    floor,
    a.wall,
    b.wall,
    aBinding.segmentId,
    bBinding.segmentId,
    operation.resolutions || {},
    createId
  );
  if (contactThickness != null) {
    // Keep the geometric width until the session has divided the combined run
    // by adjacency. Resolving one value on the whole run here loses the metric
    // change needed for its newly interior and remaining exterior pieces.
    merged.properties.wall_thickness_m = thickness;
    rebindBuildingPlanFaces(floor, createId);
    return;
  }
  const conflicts = reconcileBuildingPlanProperties({ floors: [floor] }, specifications).filter(
    (issue) => issue.code !== 'conflicting_room_defaults'
  );
  if (conflicts.length) {
    const error = new Error(conflicts[0].message);
    error.issues = conflicts;
    throw error;
  }
  rebindBuildingPlanFaces(floor, createId);
}

function prospectiveContactThickness(floor, wall, owner, room, neighbour, specifications) {
  const prospective = {
    ...wall,
    exposure: 'interior',
    overrides: { ...owner.overrides, ...wall.overrides },
    sides: wall.sides.map((side, index) => ({ ...side, roomId: index ? room.id : neighbour.id })),
  };
  return resolveInheritedProperty(
    { floor, subject: prospective, wall: prospective, nodeKey: 'walls' },
    'wall_thickness_m',
    propertySpecification(specifications, 'wall_thickness_m')
  ).value;
}

function roomContacts(floor, room, operation, specifications) {
  const tolerance = operation.attachmentTolerance ?? 0;
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 0.5)
    failOperation(
      'invalid_snap_tolerance',
      'Room attachment tolerance must be between zero and half a metre.'
    );
  const contacts = [];
  for (const face of room.faces) {
    if (
      face.freePath ||
      !face.bindings.length ||
      facesOfWall(floor, face.wallId).some(
        (entry) =>
          entry.room.id !== room.id &&
          entry.face.bindings.some((other) =>
            face.bindings.some(
              (binding) =>
                binding.segmentId === other.segmentId &&
                Math.min(binding.interval[1], other.interval[1]) -
                  Math.max(binding.interval[0], other.interval[0]) >
                  EPS
            )
          )
      )
    )
      continue;
    const owner = findWall(floor, face.wallId);
    const edge = sourceEdges(room, face)[0];
    if (!edge) continue;
    const matches = [];
    for (const neighbour of floor.rooms.filter((entry) => entry.id !== room.id))
      for (const reference of neighbour.faces.filter(
        (entry) => !entry.freePath && entry.bindings.length
      )) {
        const wall = findWall(floor, reference.wallId);
        const thickness = wall.properties.wall_thickness_m;
        if (!Number.isFinite(thickness)) continue;
        if (owner.lineage?.explicitPhysicalSeparation || wall.lineage?.explicitPhysicalSeparation) {
          const a = owner.segments[0],
            b = wall.segments[0];
          if (owner.segments.length !== 1 || wall.segments.length !== 1) continue;
          const frame = segmentFrame(a.start, a.end);
          const positions = [project(frame, b.start), project(frame, b.end)];
          if (positions.some((point) => Math.abs(point.offset) > EPS)) continue;
          const from = Math.min(0, ...positions.map((point) => point.along));
          const to = Math.max(frame.length, ...positions.map((point) => point.along));
          // Opposite faces may bind up to a deliberate cut. They may not merge
          // across one, even when their accepted values happen to agree.
          const crossesCut = buildingPlanEditingCutStations(floor, frame, thickness / 2).some(
            (station) => station > from + EPS && station < to - EPS
          );
          if (crossesCut) continue;
        }
        for (const otherEdge of sourceEdges(neighbour, reference)) {
          if (dot(edge.tangent, otherEdge.tangent) > -1 + EPS) continue;
          const gap = project(otherEdge, edge.start).offset;
          const inherited = prospectiveContactThickness(
            floor,
            wall,
            owner,
            room,
            neighbour,
            specifications
          );
          const widths = [...new Set([thickness, inherited])].filter(
            (value) => Number.isFinite(value) && value > 0
          );
          const contactThickness = widths.sort(
            (a, b) => Math.abs(Math.abs(gap) - a) - Math.abs(Math.abs(gap) - b)
          )[0];
          const expected = -Math.sign(polygonArea(neighbour.vertices)) * contactThickness;
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
            contactThickness,
            seatThickness: operation.keepContactThickness
              ? thickness
              : Number.isFinite(inherited) && inherited > 0
                ? inherited
                : contactThickness,
            mismatch: Math.abs(gap - expected),
          });
        }
      }
    matches.sort(
      (a, b) => a.mismatch - b.mismatch || a.referenceFaceId.localeCompare(b.referenceFaceId)
    );
    if (matches.length)
      contacts.push({
        ...matches[0],
        faceId: face.id,
        edgeId: edge.id,
        align: tolerance > 0,
        resolutions: operation.resolutions,
      });
  }
  return contacts;
}

function attachRoom(floor, room, operation, createId, specifications) {
  const contacts = roomContacts(floor, room, operation, specifications);
  if (contacts.some((contact) => contact.align)) {
    // Rooms already in place keep their faces: seat the attached room once, at each
    // contact's resolved shared thickness, before any binding makes it connected.
    const delta = attachmentSeatingDelta(floor, room, contacts);
    if (!delta)
      failOperation(
        'attachment_fit_conflict',
        'This room cannot meet all of its neighbours at their shared wall thickness. Attach it to fewer rooms or adjust its size.'
      );
    if (Math.hypot(delta.x, delta.y) > EPS) translateUnsharedRoom(floor, room, delta);
    rebindBuildingPlanFaces(floor, createId);
    for (const contact of contacts) contact.contactThickness = contact.seatThickness;
  }
  for (const contact of contacts)
    bindFaces(floor, contact, createId, specifications, contact.contactThickness);
}

/** Discover every prospective contact before binding any of them. */
export function reconcileBuildingPlanContacts(floor, operation, createId, specifications) {
  const contacts = floor.rooms.flatMap((room) =>
    roomContacts(floor, room, { ...operation, attachmentTolerance: 0 }, specifications)
  );
  const roomOf = (id) => floor.rooms.find((room) => room.faces.some((face) => face.id === id))?.id;
  // Retain the selected room's construction as the reference when a new
  // contact is assembled; choosing the opposite reference changes its anchor.
  contacts.sort(
    (a, b) =>
      Number(roomOf(b.referenceFaceId) === operation.activeRoomId) -
        Number(roomOf(a.referenceFaceId) === operation.activeRoomId) ||
      a.referenceFaceId.localeCompare(b.referenceFaceId) ||
      a.faceId.localeCompare(b.faceId)
  );
  const seen = new Set();
  for (const contact of contacts) {
    const key = JSON.stringify([contact.faceId, contact.referenceFaceId].sort());
    if (seen.has(key)) continue;
    seen.add(key);
    const a = findFace(floor, contact.faceId),
      b = findFace(floor, contact.referenceFaceId);
    if (a.wall === b.wall) continue;
    bindFaces(floor, contact, createId, specifications, contact.contactThickness);
  }
}

export function applyThicknessChanges(
  floor,
  before,
  activeRoomId,
  createId,
  operation = {},
  specifications
) {
  if (
    floor.walls.some((wall) => {
      const old = before.walls.find((other) => other.id === wall.id);
      return old && wall.properties.wall_thickness_m !== old.properties.wall_thickness_m;
    })
  ) {
    before = copy(before);
    const identities = new Map();
    materializeBuildingPlanProfiles(before, createId, identities);
    materializeBuildingPlanProfiles(floor, createId, identities);
  }
  const edit = reshapeBuildingPlanAxisThickness(
    floor,
    before,
    { ...operation, activeRoomId },
    createId
  );
  const { changedEdges, affectedWalls: affected } = edit;
  finishBoundaryEdit(
    floor,
    before,
    changedEdges,
    affected,
    {
      ...operation,
      activeRoomId,
      transformedSegments: edit.transformed,
    },
    createId,
    specifications,
    [],
    true
  );
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
    thicknessAnchor: operation.thicknessAnchor ?? editingPolicy.thicknessAnchor ?? 'room_face',
  };
  if (
    ['resize_face', 'resize_room', 'resize_preserve_group', 'move_corner', 'move_room'].includes(
      operation.type
    )
  )
    materializeBuildingPlanProfiles(findBuildingPlanFloor(snapshot, operation.floorId), createId);
  if (!['room_face', 'midline'].includes(operation.thicknessAnchor))
    failOperation('invalid_editing_policy', 'thicknessAnchor must be room_face or midline.');
  if (operation.type === 'batch') {
    if (
      !Array.isArray(operation.operations) ||
      operation.operations.some((entry) => !entry || entry.type === 'batch')
    )
      failOperation('invalid_batch', 'A batch requires a flat list of operations.');
    const propertyOperations = operation.operations.filter((entry) =>
      ['set_property', 'set_defaults', 'set_provider'].includes(entry.type)
    );
    const before = copy(snapshot);
    const activeRoomsByWall = {};
    for (const entry of propertyOperations) {
      if (entry.faceId) {
        const selected = findFace(findBuildingPlanFloor(snapshot, entry.floorId), entry.faceId);
        activeRoomsByWall[selected.wall.id] = entry.activeRoomId || selected.room.id;
      }
      const floor = findBuildingPlanFloor(snapshot, entry.floorId);
      applyProperty(floor, entry, specifications);
    }
    const issues = reconcileBuildingPlanProperties(snapshot, specifications).filter(
      (issue) => issue.code !== 'conflicting_room_defaults'
    );
    if (issues.length) throw Object.assign(new Error(issues[0].message), { issues });
    for (const floor of snapshot.floors) {
      const previous = before.floors.find((entry) => entry.id === floor.id);
      if (previous)
        applyThicknessChanges(
          floor,
          previous,
          operation.activeRoomId,
          createId,
          { ...operation, activeRoomsByWall },
          specifications
        );
    }
    const created = [];
    for (const entry of operation.operations.filter((item) => !propertyOperations.includes(item))) {
      const result = applyBuildingPlanOperation(snapshot, entry, {
        createId,
        specifications,
        editingPolicy: {
          ...editingPolicy,
          thicknessAnchor: operation.thicknessAnchor,
        },
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
    case 'split_face':
      return splitEditingFace(floor, operation, createId);
    case 'rejoin_cut':
      return rejoinEditingCut(floor, operation, createId);
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
        sides: createWallSides(createId),
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
      resizeFace(floor, operation, createId, specifications);
      break;
    case 'move_corner': {
      const edit = reshapeBuildingPlanAxes(floor, operation, createId);
      finishBoundaryEdit(
        floor,
        edit.before,
        edit.changedEdges,
        edit.affectedWalls,
        { ...operation, activeRoomId: operation.roomId, transformedSegments: edit.transformed },
        createId,
        specifications
      );
      break;
    }
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
            },
            createId,
            specifications
          );
        }
      }
      break;
    }
    case 'update_wall': {
      if (
        operation.faceId &&
        findFace(floor, operation.faceId).face.freePath?.some((point) => point.editingCutId)
      ) {
        movePartitionPortion(floor, operation, {
          createId,
          splitSegment: splitGeometrySegment,
          finish: (before, walls) =>
            finishBoundaryEdit(floor, before, [], walls, operation, createId, specifications),
        });
        break;
      }
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
        cleanPoint({ ...face.freePath[index], ...p, id: face.freePath[index].id })
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
      const segment = wall.segments[0];
      const frame = segmentFrame(segment.start, segment.end);
      const cut = operation.offset;
      if (!Number.isFinite(cut) || cut <= EPS || cut >= frame.length - EPS)
        failOperation('invalid_split', 'Choose an interior wall position.');
      const target = facesOfWall(floor, wall.id).find(({ face }) =>
        face.bindings.some(
          (binding) =>
            binding.segmentId === segment.id &&
            binding.interval[0] < cut - EPS &&
            binding.interval[1] > cut + EPS
        )
      );
      if (!target) failOperation('invalid_split', 'Choose a captured interior wall position.');
      const binding = target.face.bindings.find(
        (binding) =>
          binding.segmentId === segment.id &&
          binding.interval[0] < cut - EPS &&
          binding.interval[1] > cut + EPS
      );
      const low = Math.min(
        ...target.face.bindings
          .filter((entry) => entry.edgeId === binding.edgeId)
          .map((entry) => entry.roomInterval[0])
      );
      return splitEditingFace(
        floor,
        {
          faceId: target.face.id,
          edgeId: binding.edgeId,
          offset:
            binding.roomInterval[0] -
            low +
            (binding.direction > 0 ? cut - binding.interval[0] : binding.interval[1] - cut),
        },
        createId
      );
    }
    case 'resize_preserve_group': {
      if (!Array.isArray(operation.affectedRoomIds) || !operation.affectedRoomIds.length)
        failOperation('affected_group_required', 'Explicitly identify the affected room group.');
      const before = copy(floor);
      resizeFace(floor, operation, createId, specifications);
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
              resizeFace(
                floor,
                { faceId: face.id, edgeId: edge.id, distance: outward },
                createId,
                specifications
              );
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
    case 'set_defaults':
    case 'set_provider': {
      const before = copy(floor);
      applyProperty(floor, operation, specifications);
      const issues = reconcileBuildingPlanProperties(snapshot, specifications).filter(
        (issue) => issue.code !== 'conflicting_room_defaults'
      );
      if (issues.length) throw Object.assign(new Error(issues[0].message), { issues });
      applyThicknessChanges(
        floor,
        before,
        operation.activeRoomId ||
          operation.roomId ||
          (operation.faceId ? findFace(floor, operation.faceId).room.id : null),
        createId,
        operation,
        specifications
      );
      break;
    }
    case 'set_values':
    case 'set_custom_rows': {
      const subject = operationSubject(floor, operation);
      if (operation.type === 'set_custom_rows')
        subject.repeatable = copy(operation.repeatable || {});
      else
        for (const [key, value] of Object.entries(operation.values || {})) {
          propertyKey(key);
          subject.values ||= {};
          subject.values[key] = copy(value);
        }
      break;
    }
    case 'create_opening':
    case 'update_opening':
    case 'remove_opening': {
      const result = applyOpeningOperation(floor, operation, createId);
      if (result.created) return result;
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

      room.faces = room.faces.filter((entry) => entry.id !== face.id);
      if (exclusive) floor.walls = floor.walls.filter((entry) => entry.id !== wall.id);
      else if (wall.referenceFaceId === face.id)
        wall.referenceFaceId = facesOfWall(floor, wall.id)[0]?.face.id || null;
      break;
    }
    case 'remove_floor': {
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
        room[operation.collection] = list.filter((entry) => entry !== item);
      } else Object.assign(item, copy(operation.element || {}), { id: item.id });
      break;
    }
    default:
      failOperation('unknown_operation', `Unsupported building-plan operation: ${operation.type}`);
  }
  const conflicts = ['resize_face', 'resize_room', 'move_corner', 'move_room'].includes(
    operation.type
  )
    ? []
    : reconcileBuildingPlanProperties(snapshot, specifications).filter(
        (issue) => issue.code !== 'conflicting_room_defaults'
      );
  if (conflicts.length) {
    const error = new Error(conflicts[0].message);
    error.issues = conflicts;
    throw error;
  }
  rebindBuildingPlanFaces(floor, createId);
  if (
    [
      'move_corner',
      'resize_face',
      'resize_room',
      'set_property',
      'set_defaults',
      'set_provider',
    ].includes(operation.type)
  )
    for (const wall of floor.walls)
      for (const opening of [...wall.doors, ...wall.windows]) {
        const field = `${opening.type}_offset_m`;
        if (own(opening.values, field)) opening.values[field] = opening.offset;
      }
  return {};
}
