import { createWallSides, wallSide } from './wall-sides.js';
import { resolveInheritedProperty, nodeSubjects } from './inheritance.js';
import { generateUuidV7 } from '../utilities/uuid.js';
import { validateFieldValue } from '../schema/field-value-registry.js';
import {
  GEOMETRY_EPSILON as EPS,
  add,
  at,
  assignRoomEdges,
  cleanPoint,
  distance,
  dot,
  isPoint,
  multiply,
  near,
  polygonArea,
  polygonEdges,
  polygonIssue,
  pointInPolygon,
  polygonsOverlap,
  project,
  segmentFrame,
  subtract,
} from './geometry.js';

export const BUILDING_PLAN_VERSION = 2;
export const BUILDING_PLAN_PROPERTIES = Object.freeze({
  wall_thickness_m: Object.freeze({ scope: 'physical_wall', inherit: true, fallback: 0.2 }),
  wall_height_m: Object.freeze({ scope: 'physical_wall', inherit: true, fallback: null }),
});
export const copyBuildingPlanData = (value) =>
  value === undefined
    ? undefined
    : typeof structuredClone === 'function'
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
export const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
export const equalValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const planIssue = (code, message, subject = null, details = {}) => ({
  code,
  message,
  subject,
  ...details,
});

export function createBuildingPlanSnapshot() {
  return { version: BUILDING_PLAN_VERSION, unit: 'm', axes: 'x-right-y-down', floors: [] };
}

export function findBuildingPlanFloor(snapshot, floorId) {
  const floor = snapshot.floors.find((entry) => entry.id === floorId);
  if (!floor) throw new Error('The building-plan floor no longer exists.');
  return floor;
}

export function findRoom(floor, roomId) {
  const room = floor.rooms.find((entry) => entry.id === roomId);
  if (!room) throw new Error('The room no longer exists.');
  return room;
}

export function findWall(floor, wallId) {
  const wall = floor.walls.find((entry) => entry.id === wallId);
  if (!wall) throw new Error('The physical wall no longer exists.');
  return wall;
}

export function findFace(floor, faceId) {
  for (const room of floor.rooms) {
    const face = room.faces.find((entry) => entry.id === faceId);
    if (face) return { room, face, wall: findWall(floor, face.wallId) };
  }
  throw new Error('The room-facing wall portion no longer exists.');
}

export function facesOfWall(floor, wallId) {
  return floor.rooms.flatMap((room) =>
    room.faces.filter((face) => face.wallId === wallId).map((face) => ({ room, face }))
  );
}

export const buildingPlanSegmentThickness = (wall, segment) => wall.properties.wall_thickness_m;

/** Defaults are proposals/properties, never measurements or new evidence. */
export function resolveBuildingPlanProperty(
  floor,
  wall,
  property,
  specification = BUILDING_PLAN_PROPERTIES[property]
) {
  return resolveInheritedProperty(
    { floor, subject: wall, wall, nodeKey: 'walls' },
    property,
    specification
  );
}

export function resolveRoomFaceProperty(floor, room, face, property, specification = {}) {
  const wall = floor.walls.find((entry) => entry.id === face.wallId);
  const side = wallSide(floor, face);
  return resolveInheritedProperty(
    { floor, subject: side || face, wall, side, room, nodeKey: 'walls' },
    property,
    specification
  );
}

// Geometry spans are references only in version 2; all physical answers belong to the wall.
export function resolveBuildingPlanSegmentProperty(
  floor,
  wall,
  _segment,
  property,
  specification = BUILDING_PLAN_PROPERTIES[property]
) {
  return resolveBuildingPlanProperty(floor, wall, property, specification);
}

export function reconcileBuildingPlanProperties(
  snapshot,
  specifications = BUILDING_PLAN_PROPERTIES
) {
  const issues = [];
  const assign = (subject, property, specification, context) => {
    if (specification.kind === 'collection') return;
    subject.properties ||= {};
    subject.provenance ||= {};
    subject.overrides ||= {};
    const resolved = resolveInheritedProperty({ ...context, subject }, property, specification);
    if (resolved.conflict) {
      issues.push(resolved.conflict);
      return;
    }
    subject.properties[property] = resolved.value;
    if (context.nodeKey !== 'walls') {
      subject.values ||= {};
      subject.values[property] = copyBuildingPlanData(resolved.value);
      const dimensions = {
        door_width_m: 'width',
        door_height_m: 'height',
        window_width_m: 'width',
        window_height_m: 'height',
        window_distance_from_floor_m: 'sillHeight',
        column_cross_section_width_m: 'width',
        column_cross_section_height_m: 'height',
        beam_cross_section_width_m: 'width',
        beam_cross_section_height_m: 'height',
      };
      if (dimensions[property])
        subject[dimensions[property]] = copyBuildingPlanData(resolved.value);
    }
    subject.provenance[property] = { ...resolved.source, mode: resolved.mode };
    const error = specification.field && validateFieldValue(specification.field, resolved.value);
    if (error)
      issues.push(
        planIssue(
          'invalid_property_value',
          error,
          { type: context.nodeKey, id: subject.id },
          { property }
        )
      );
  };
  for (const floor of snapshot.floors) {
    for (const wall of floor.walls) {
      wall.properties ||= {};
      wall.provenance ||= {};
      for (const [key, specification] of Object.entries(specifications)) {
        const property = specification.property || key;
        if (specification.scope === 'physical_wall')
          assign(wall, property, specification, { floor, wall, nodeKey: 'walls' });
        else if (['wall_face', 'room_face'].includes(specification.scope))
          for (const side of wall.sides || [])
            assign(side, property, specification, { floor, wall, side, nodeKey: 'walls' });
      }
    }
    for (const [key, specification] of Object.entries(specifications)) {
      if (specification.scope !== 'node') continue;
      for (const context of nodeSubjects(floor, specification.nodeKey))
        assign(context.subject, specification.property || key, specification, {
          floor,
          nodeKey: specification.nodeKey,
          ...context,
        });
    }
    for (const room of floor.rooms)
      for (const face of room.faces) {
        const side = wallSide(floor, face);
        if (side) {
          face.properties = copyBuildingPlanData(side.properties);
          face.provenance = copyBuildingPlanData(side.provenance);
          face.overrides = copyBuildingPlanData(side.overrides);
          face.values = copyBuildingPlanData(side.values);
        }
      }
  }
  return issues;
}

function faceEdges(room, face) {
  if (!face.freePath)
    return polygonEdges(room).filter((edge) => !face.edgeIds || face.edgeIds.includes(edge.id));
  return face.freePath.slice(0, -1).map((start, index) => ({
    id: face.freeEdges[index],
    ...segmentFrame(start, face.freePath[index + 1]),
  }));
}

/** Remap only existing, explicitly established subjects; proximity never merges walls. */
export function rebindBuildingPlanFaces(floor, createId = generateUuidV7) {
  for (const room of floor.rooms)
    for (const face of room.faces) {
      const wall = findWall(floor, face.wallId);
      const previous = face.bindings || [];
      const bindings = [];
      for (const edge of faceEdges(room, face))
        for (const segment of wall.segments) {
          const thickness = wall.properties.wall_thickness_m;
          const frame = segmentFrame(segment.start, segment.end);
          if (Math.abs(dot(frame.normal, edge.tangent)) > EPS) continue;
          const a = project(frame, edge.start);
          const b = project(frame, edge.end);
          const half = typeof thickness === 'number' ? thickness / 2 : segment.referenceOffset || 0;
          if (!near(Math.abs(a.offset), half) || !near(a.offset, b.offset)) continue;
          const low = Math.max(0, Math.min(a.along, b.along));
          const high = Math.min(frame.length, Math.max(a.along, b.along));
          if (high - low <= EPS) continue;
          const direction = dot(frame.tangent, edge.tangent) >= 0 ? 1 : -1;
          if (
            !face.freePath &&
            half > EPS &&
            (a.offset < 0 ? -1 : 1) !== direction * Math.sign(polygonArea(room.vertices))
          )
            continue;
          const edgeStart = project(edge, at(frame, low, a.offset)).along;
          const edgeEnd = project(edge, at(frame, high, a.offset)).along;
          const old = previous.find(
            (entry) => entry.edgeId === edge.id && entry.segmentId === segment.id
          );
          bindings.push({
            id: old?.id || createId(),
            segmentId: segment.id,
            edgeId: edge.id,
            interval: [low, high],
            roomInterval: [Math.min(edgeStart, edgeEnd) || 0, Math.max(edgeStart, edgeEnd) || 0],
            direction,
            side: a.offset < 0 ? -1 : 1,
          });
        }
      face.bindings = bindings;
      const side = wall.sides?.find((entry) => entry.sign === bindings[0]?.side);
      if (side) face.sideId = side.id;
    }
}

export function createBuildingPlanFloor({
  id = generateUuidV7(),
  values = {},
  defaults = {},
} = {}) {
  return {
    id,
    values: copyBuildingPlanData(values),
    defaults: copyBuildingPlanData(defaults),
    rooms: [],
    walls: [],
  };
}

export function createBuildingPlanRoom(
  floor,
  { id, rectangle, vertices, values = {}, defaults = {} },
  createId = generateUuidV7,
  specifications = BUILDING_PLAN_PROPERTIES
) {
  const input = vertices || [
    { x: rectangle.x, y: rectangle.y },
    { x: rectangle.x + rectangle.width, y: rectangle.y },
    { x: rectangle.x + rectangle.width, y: rectangle.y + rectangle.height },
    { x: rectangle.x, y: rectangle.y + rectangle.height },
  ];
  const room = {
    id: id || createId(),
    values: copyBuildingPlanData(values),
    defaults: copyBuildingPlanData(defaults),
    vertices: input.map((p) => cleanPoint({ ...p, id: p.id || createId() })),
    edges: [],
    faces: [],
    columns: [],
    beams: [],
    objects: [],
  };
  const problem = polygonIssue(room.vertices);
  if (problem) throw new Error(problem);
  assignRoomEdges(room, createId);
  floor.rooms.push(room);
  const side = Math.sign(polygonArea(room.vertices));
  for (const edge of polygonEdges(room)) {
    const wallId = createId();
    const face = {
      id: createId(),
      wallId,
      edgeIds: [edge.id],
      overrides: {},
      bindings: [],
      values: {},
    };
    room.faces.push(face);
    const wall = {
      id: wallId,
      overrides: {},
      properties: {},
      provenance: {},
      values: {},
      referenceFaceId: face.id,
      segments: [],
      sides: createWallSides(createId),
      doors: [],
      windows: [],
    };
    floor.walls.push(wall);
    const thickness = resolveBuildingPlanProperty(
      floor,
      wall,
      'wall_thickness_m',
      specifications.wall_thickness_m
    ).value;
    const offset = typeof thickness === 'number' && thickness > 0 ? thickness / 2 : 0;
    wall.segments.push({
      id: createId(),
      start: at(edge, 0, -side * offset),
      end: at(edge, edge.length, -side * offset),
      referenceOffset: offset,
    });
  }
  reconcileBuildingPlanProperties({ floors: [floor] }, specifications);
  rebindBuildingPlanFaces(floor, createId);
  return room;
}

export function buildingPlanFaceSegments(floor, room, face) {
  const wall = findWall(floor, face.wallId);
  return face.bindings.map((binding) => {
    const segment = wall.segments.find((entry) => entry.id === binding.segmentId);
    const frame = segmentFrame(segment.start, segment.end);
    const offset =
      (binding.side *
        (buildingPlanSegmentThickness(wall, segment) ?? (segment.referenceOffset ?? 0) * 2)) /
      2;
    return {
      ...binding,
      start: at(frame, binding.interval[0], offset),
      end: at(frame, binding.interval[1], offset),
      roomId: room.id,
      wallId: wall.id,
      faceId: face.id,
    };
  });
}

export function validateBuildingPlanSnapshot(snapshot) {
  try {
    return validateSnapshot(snapshot);
  } catch {
    return [
      planIssue(
        'invalid_snapshot',
        'The building-plan snapshot has malformed subject or geometry data.'
      ),
    ];
  }
}

function validateSnapshot(snapshot) {
  const issues = [];
  if (
    !snapshot ||
    snapshot.version !== BUILDING_PLAN_VERSION ||
    snapshot.unit !== 'm' ||
    !Array.isArray(snapshot.floors)
  )
    return [
      planIssue(
        'invalid_snapshot',
        'Expected BuildingPlan version 2 metric data. Version 1 development payloads are not migrated.'
      ),
    ];
  const ids = new Map();
  const subjectFloors = new Map();
  let containingFloor;
  const register = (type, entity) => {
    if (
      type === 'vertex' &&
      entity &&
      own(entity, 'editingCutId') &&
      (typeof entity.editingCutId !== 'string' || !entity.editingCutId.trim())
    )
      issues.push(
        planIssue('invalid_editing_cut', 'An editing cut requires a nonempty string identity.', {
          type,
          id: entity.id,
        })
      );
    if (!entity || typeof entity.id !== 'string' || !entity.id || ids.has(entity.id))
      issues.push(
        planIssue('invalid_identity', 'Subject and geometry IDs must be nonempty and unique.', {
          type,
          id: entity?.id,
        })
      );
    else {
      ids.set(entity.id, type);
      subjectFloors.set(entity.id, containingFloor);
    }
  };
  for (const floor of snapshot.floors) {
    containingFloor = floor.id;
    register('floor', floor);
    if (![floor.rooms, floor.walls].every(Array.isArray)) {
      issues.push(
        planIssue('invalid_floor', 'A floor requires rooms and physical walls.', {
          type: 'floor',
          id: floor.id,
        })
      );
      continue;
    }
    if (own(floor, 'observations'))
      issues.push(
        planIssue(
          'removed_observations',
          'Predefined observation collections are not supported in version 2.'
        )
      );
    for (const wall of floor.walls) {
      register('wall', wall);
      if (
        !Array.isArray(wall.sides) ||
        wall.sides.length !== 2 ||
        ![-1, 1].every((sign) => wall.sides.some((side) => side.sign === sign))
      )
        issues.push(
          planIssue('invalid_wall_sides', 'A physical wall requires two canonical sides.', {
            type: 'wall',
            id: wall.id,
          })
        );
      for (const side of wall.sides || []) register('wall_face', side);
      if (!Array.isArray(wall.segments) || wall.segments.length !== 1)
        issues.push(
          planIssue(
            'invalid_wall',
            'A physical wall requires exactly one straight geometry span.',
            {
              type: 'wall',
              id: wall.id,
            }
          )
        );
      for (const segment of wall.segments || []) {
        register('segment', segment);
        if (['overrides', 'properties', 'provenance'].some((key) => own(segment, key)))
          issues.push(
            planIssue(
              'segment_property_removed',
              'Geometry spans cannot own physical properties in version 2.'
            )
          );
        if (
          !isPoint(segment.start) ||
          !isPoint(segment.end) ||
          distance(segment.start, segment.end) <= EPS
        )
          issues.push(
            planIssue(
              'invalid_wall_geometry',
              'Wall segments require finite, distinct endpoints.',
              { type: 'wall', id: wall.id }
            )
          );
      }
      for (const property of ['wall_thickness_m', 'wall_height_m']) {
        const value = wall.properties?.[property];
        if (value != null && (!Number.isFinite(value) || value <= 0))
          issues.push(
            planIssue(
              'invalid_dimension',
              'A known wall dimension must be a positive finite number.',
              { type: 'wall', id: wall.id },
              { property }
            )
          );
      }
      const openings = [...(wall.doors || []), ...(wall.windows || [])];
      for (const opening of openings) {
        register(opening.type || 'opening', opening);
        const segment = wall.segments?.find((entry) => entry.id === opening.segmentId);
        const hostHeight = wall.properties.wall_height_m;
        if (
          !segment ||
          !Number.isFinite(opening.offset) ||
          !Number.isFinite(opening.width) ||
          opening.width <= 0 ||
          opening.offset < -EPS ||
          opening.offset + opening.width > distance(segment.start, segment.end) + EPS
        )
          issues.push(
            planIssue(
              'opening_outside_wall',
              'The opening does not fit on its host wall. Move it or change the wall edit.',
              { type: opening.type || 'opening', id: opening.id }
            )
          );
        if (
          (opening.height != null && (!Number.isFinite(opening.height) || opening.height <= 0)) ||
          (opening.sillHeight != null &&
            (!Number.isFinite(opening.sillHeight) || opening.sillHeight < 0)) ||
          (hostHeight != null &&
            opening.height != null &&
            (opening.sillHeight || 0) + opening.height > hostHeight + EPS)
        )
          issues.push(
            planIssue(
              'opening_height_conflict',
              'The opening height and sill must fit the accepted wall height.',
              { type: opening.type, id: opening.id }
            )
          );
      }
      for (let i = 0; i < openings.length; i++)
        for (let j = i + 1; j < openings.length; j++) {
          const a = openings[i],
            b = openings[j];
          if (a.segmentId !== b.segmentId) continue;
          if (
            a.height != null &&
            b.height != null &&
            Math.min((a.sillHeight || 0) + a.height, (b.sillHeight || 0) + b.height) -
              Math.max(a.sillHeight || 0, b.sillHeight || 0) <=
              EPS
          )
            continue;
          if (Math.min(a.offset + a.width, b.offset + b.width) - Math.max(a.offset, b.offset) > EPS)
            issues.push(
              planIssue(
                'overlapping_openings',
                'Two openings overlap on this wall.',
                { type: 'wall', id: wall.id },
                { openingIds: [a.id, b.id] }
              )
            );
        }
    }
    for (const room of floor.rooms) {
      register('room', room);
      const problem = polygonIssue(room.vertices);
      if (problem)
        issues.push(planIssue('invalid_room_geometry', problem, { type: 'room', id: room.id }));
      for (const vertex of room.vertices || []) register('vertex', vertex);
      for (const edge of room.edges || []) {
        register('edge', edge);
        if (
          own(edge, 'profile') &&
          (!edge.profile ||
            !floor.walls.some((wall) => wall.id === edge.profile.wallId) ||
            ![-1, 1].includes(edge.profile.sideSign))
        )
          issues.push(
            planIssue(
              'invalid_material_profile',
              'A material profile must reference an existing physical wall and canonical side.',
              { type: 'edge', id: edge.id }
            )
          );
      }
      if (
        room.edges?.length !== room.vertices.length ||
        room.vertices.some(
          (vertex, index) =>
            room.edges.filter(
              (edge) =>
                edge.startId === vertex.id &&
                edge.endId === room.vertices[(index + 1) % room.vertices.length].id
            ).length !== 1
        )
      )
        issues.push(
          planIssue(
            'invalid_room_topology',
            'Room segments must identify each consecutive pair of vertices once.',
            { type: 'room', id: room.id }
          )
        );
      for (const kind of ['columns', 'beams', 'objects'])
        for (const item of room[kind] || []) {
          register({ columns: 'column', beams: 'beam', objects: 'object' }[kind], item);
          const points = [item.position, item.start, item.end].filter((point) => point != null);
          if (
            points.some(
              (point) => !isPoint(point) || (!problem && !pointInPolygon(point, room.vertices))
            ) ||
            (item.start && item.end && distance(item.start, item.end) <= EPS) ||
            ['width', 'height'].some(
              (key) => item[key] != null && (!Number.isFinite(item[key]) || item[key] <= 0)
            )
          )
            issues.push(
              planIssue(
                'invalid_room_element',
                'Keep structural elements inside their room with positive, finite dimensions.',
                { type: kind, id: item.id }
              )
            );
        }
      for (const face of room.faces || []) {
        register('room_face', face);
        for (const vertex of face.freePath || []) register('vertex', vertex);
        for (const edgeId of face.freeEdges || []) register('edge', { id: edgeId });
        if (!floor.walls.some((wall) => wall.id === face.wallId)) {
          issues.push(
            planIssue(
              'dangling_wall_reference',
              'A room-facing portion references a missing physical wall.',
              { type: 'room_face', id: face.id }
            )
          );
          continue;
        }
        if (!face.bindings?.length)
          issues.push(
            planIssue(
              'unbound_room_face',
              'The room-facing portion no longer matches its physical wall.',
              { type: 'room_face', id: face.id }
            )
          );
        for (const edge of faceEdges(room, face))
          if (!face.bindings?.some((binding) => binding.edgeId === edge.id))
            issues.push(
              planIssue(
                'unbound_facing_edge',
                'A straight facing portion needs a physical wall binding.',
                { type: 'room_face', id: face.id }
              )
            );
        for (const binding of face.bindings || []) {
          register('binding', binding);
          const wall = findWall(floor, face.wallId);
          const segment = wall.segments.find((entry) => entry.id === binding.segmentId);
          const edge = problem
            ? null
            : faceEdges(room, face).find((entry) => entry.id === binding.edgeId);
          if (
            !segment ||
            !edge ||
            !Array.isArray(binding.interval) ||
            !Array.isArray(binding.roomInterval) ||
            binding.interval.length !== 2 ||
            binding.roomInterval.length !== 2 ||
            ![...binding.interval, ...binding.roomInterval].every(Number.isFinite) ||
            ![-1, 1].includes(binding.direction) ||
            ![-1, 1].includes(binding.side) ||
            binding.roomInterval[0] < -EPS ||
            binding.roomInterval[1] > edge.length + EPS ||
            !near(
              binding.roomInterval[1] - binding.roomInterval[0],
              binding.interval[1] - binding.interval[0]
            ) ||
            binding.interval[1] - binding.interval[0] <= EPS ||
            binding.interval[0] < -EPS ||
            binding.interval[1] > distance(segment.start, segment.end) + EPS
          ) {
            issues.push(
              planIssue('invalid_binding', 'The wall binding has a missing or invalid extent.', {
                type: 'room_face',
                id: face.id,
              })
            );
            continue;
          }
          const frame = segmentFrame(segment.start, segment.end);
          if (
            !near(
              project(frame, at(edge, binding.roomInterval[0])).along,
              binding.interval[binding.direction > 0 ? 0 : 1]
            ) ||
            !near(
              project(frame, at(edge, binding.roomInterval[1])).along,
              binding.interval[binding.direction > 0 ? 1 : 0]
            )
          )
            issues.push(
              planIssue(
                'invalid_binding_extent',
                'The facing extent must match its host segment coordinates.',
                { type: 'room_face', id: face.id }
              )
            );
          if (
            !face.freePath &&
            (buildingPlanSegmentThickness(wall, segment) ?? (segment.referenceOffset ?? 0) * 2) >
              EPS &&
            binding.side !== binding.direction * Math.sign(polygonArea(room.vertices))
          )
            issues.push(
              planIssue(
                'invalid_binding_side',
                'A captured boundary must face the room interior, not the opposite wall face.',
                { type: 'room_face', id: face.id }
              )
            );
          const expected =
            (binding.side *
              (buildingPlanSegmentThickness(wall, segment) ?? (segment.referenceOffset ?? 0) * 2)) /
            2;
          for (const along of binding.roomInterval) {
            const projection = project(frame, at(edge, along));
            if (!near(projection.offset, expected))
              issues.push(
                planIssue(
                  'binding_thickness_mismatch',
                  'Captured faces and accepted wall thickness disagree.',
                  { type: 'room_face', id: face.id }
                )
              );
          }
        }
      }
    }
    for (let i = 0; i < floor.rooms.length; i++)
      for (let j = i + 1; j < floor.rooms.length; j++) {
        const a = floor.rooms[i],
          b = floor.rooms[j];
        if (
          !polygonIssue(a.vertices) &&
          !polygonIssue(b.vertices) &&
          polygonsOverlap(a.vertices, b.vertices)
        )
          issues.push(
            planIssue(
              'overlapping_rooms',
              'The proposed rooms overlap.',
              { type: 'room', id: a.id },
              { roomIds: [a.id, b.id] }
            )
          );
      }

    for (const wall of floor.walls)
      if (
        wall.referenceFaceId != null &&
        !floor.rooms.some((room) =>
          room.faces.some((face) => face.id === wall.referenceFaceId && face.wallId === wall.id)
        )
      )
        issues.push(
          planIssue(
            'invalid_reference_face',
            'The reference face must belong to this physical wall.',
            { type: 'wall', id: wall.id }
          )
        );
  }
  return issues;
}
