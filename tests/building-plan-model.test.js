import { originalFaces, originalVertices } from './helpers/building-plan-v2.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBuildingPlanSession,
  createBuildingPlanSnapshot,
  validateBuildingPlanSnapshot,
  buildingPlanPointFromViewport,
} from '../src/index.js';
import { distance, polygonArea, roomBounds } from '../src/building-plan/geometry.js';

function fixture(options = {}) {
  let serial = 0;
  const session = createBuildingPlanSession({ ...options, createId: () => `entity-${++serial}` });
  const apply = (operation, scope) => {
    const result = session.apply(operation, scope);
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    return result;
  };
  const floorId = apply({ type: 'create_floor' }).created.id;
  const room = (rectangle, defaults) =>
    apply({ type: 'create_room', floorId, rectangle, defaults }).created.id;
  return { session, apply, floorId, room, floor: () => session.getSnapshot().floors[0] };
}

function staggered() {
  const f = fixture();
  const a = f.room({ x: 0, y: 0, width: 5, height: 3 });
  const b = f.room({ x: 3, y: 3.2, width: 5, height: 3 });
  const faceA = f.floor().rooms.find((room) => room.id === a).faces[2].id;
  const faceB = f.floor().rooms.find((room) => room.id === b).faces[0].id;
  f.apply({ type: 'bind_faces', floorId: f.floorId, referenceFaceId: faceA, faceId: faceB });
  return { ...f, a, b, faceA, faceB };
}

test('empty snapshots and metric viewport conversion are portable', () => {
  assert.deepEqual(validateBuildingPlanSnapshot(createBuildingPlanSnapshot()), []);
  assert.deepEqual(buildingPlanPointFromViewport({ x: 120, y: 80 }, { x: 20, y: 30, scale: 50 }), {
    x: 2,
    y: 1,
  });
  assert.throws(() => buildingPlanPointFromViewport({ x: 0, y: 0 }, { scale: 0 }), /positive/);
});

test('room creation allocates stable physical/face/vertex IDs and does not mutate caller data', () => {
  const f = fixture();
  const rectangle = Object.freeze({ x: 0, y: 0, width: 5, height: 3 });
  f.room(rectangle);
  const floor = f.floor();
  assert.equal(floor.walls.length, 4);
  assert.equal(floor.rooms[0].faces.length, 4);
  assert.equal(floor.walls[0].properties.wall_thickness, 0.2);
  assert.equal(floor.walls[0].properties.wall_height, null);
  const snapshot = f.session.getSnapshot();
  snapshot.floors[0].walls[0].properties.wall_thickness = 99;
  assert.equal(f.floor().walls[0].properties.wall_thickness, 0.2);
  assert.deepEqual(f.session.validate(), []);
});

test('staggered faces share one two-metre physical piece between two exterior owners', () => {
  const f = staggered(),
    floor = f.floor();
  assert.equal(floor.walls.length, 9);
  const a = floor.rooms[0].faces.find((face) => face.id === f.faceA),
    b = floor.rooms[1].faces.find((face) => face.id === f.faceB);
  assert.equal(a.wallId, b.wallId);
  const wall = floor.walls.find((wall) => wall.id === a.wallId);
  assert.equal(distance(wall.segments[0].start, wall.segments[0].end), 2);
  assert.equal(a.bindings[0].interval[1] - a.bindings[0].interval[0], 2);
  assert.equal(b.bindings[0].interval[1] - b.bindings[0].interval[0], 2);
  assert.equal(wall.exposure, 'interior');
  assert.ok(floor.walls.every((wall) => wall.segments.length === 1));
});

test('a shared-piece edit creates local returns and leaves exterior siblings stationary', () => {
  const f = staggered(),
    before = f.session.getSnapshot();
  f.apply({ type: 'resize_face', floorId: f.floorId, faceId: f.faceA, distance: 0.2 });
  const floor = f.floor(),
    a = floor.rooms[0],
    b = floor.rooms[1];
  assert.ok(a.vertices.length > 4);
  assert.ok(b.vertices.length > 4);
  assert.ok(Math.abs(Math.abs(polygonArea(a.vertices)) - 15.4) < 1e-6);
  assert.ok(
    a.vertices.some((v) => v.x === 0 && v.y === 3),
    'The exterior part of the original side stays at y=3'
  );
  assert.equal(
    a.faces.find((face) => face.id === f.faceA).wallId,
    b.faces.find((face) => face.id === f.faceB).wallId
  );
  const after = f.session.getSnapshot();
  assert.equal(f.session.undo().status, 'undone');
  assert.deepEqual(f.session.getSnapshot(), before);
  assert.equal(f.session.redo().status, 'redone');
  assert.deepEqual(f.session.getSnapshot(), after);
});

test('a collapsing face edit is rejected without changing any data', () => {
  const f = staggered();
  const before = f.session.getSnapshot();
  const result = f.session.apply({
    type: 'resize_face',
    floorId: f.floorId,
    faceId: f.faceA,
    distance: 4,
  });
  assert.equal(result.status, 'conflict');
  assert.deepEqual(f.session.getSnapshot(), before);
});

test('moving a shared room keeps the original opening on the stationary owner', () => {
  const f = staggered(),
    wall = f.floor().walls.find((entry) => entry.referenceFaceId === f.faceA);
  const openingId = f.apply({
    type: 'create_opening',
    floorId: f.floorId,
    wallId: wall.id,
    kind: 'door',
    offset: 0.5,
    width: 0.9,
  }).created.id;
  const before = f.session.getSnapshot();
  f.apply({ type: 'move_room', floorId: f.floorId, roomId: f.b, delta: { x: 10, y: 0 } });
  const floor = f.floor(),
    stationary = floor.walls.find((entry) => entry.id === wall.id),
    face = floor.rooms[1].faces.find((face) => face.id === f.faceB);
  assert.notEqual(face.wallId, wall.id);
  assert.equal(stationary.doors[0].id, openingId);
  assert.equal(floor.walls.find((w) => w.id === face.wallId).doors.length, 0);
  assert.equal(Object.hasOwn(floor, 'observations'), false);
  f.session.undo();
  assert.deepEqual(f.session.getSnapshot(), before);
});

test('live inherited values update through floor, room, and wall override/reset without fake measurements', () => {
  const f = fixture();
  f.room({ x: 0, y: 0, width: 4, height: 3 });
  const wallId = f.floor().walls[0].id;
  const roomId = f.floor().rooms[0].id;
  f.apply({ type: 'set_defaults', floorId: f.floorId, property: 'wall_thickness', value: 0.22 });
  assert.equal(f.floor().walls[0].properties.wall_thickness, 0.22);
  assert.equal(f.floor().walls[0].provenance.wall_thickness.scope, 'floor');
  f.apply({
    type: 'set_defaults',
    floorId: f.floorId,
    roomId,
    property: 'wall_thickness',
    value: 0.25,
  });
  assert.equal(f.floor().walls[0].properties.wall_thickness, 0.25);
  f.apply({
    type: 'set_property',
    floorId: f.floorId,
    wallId,
    property: 'wall_thickness',
    value: 0.3,
  });
  assert.equal(f.floor().walls[0].properties.wall_thickness, 0.3);
  f.apply({
    type: 'set_property',
    floorId: f.floorId,
    wallId,
    property: 'wall_thickness',
    reset: true,
  });
  assert.equal(f.floor().walls[0].properties.wall_thickness, 0.25);
  assert.equal(Object.hasOwn(f.floor(), 'observations'), false);
});

test('conflicting room defaults require one shared wall resolution', () => {
  const f = staggered();
  f.apply({
    type: 'set_defaults',
    floorId: f.floorId,
    roomId: f.a,
    property: 'wall_height',
    value: 2.5,
  });
  const before = f.session.getSnapshot();
  const conflict = f.session.apply({
    type: 'set_defaults',
    floorId: f.floorId,
    roomId: f.b,
    property: 'wall_height',
    value: 3,
  });
  assert.equal(conflict.status, 'pending');
  f.session.resolveUIRequest(conflict.uiOperations[0].params.requestId, { cancelled: true });
  assert.deepEqual(f.session.getSnapshot(), before);
  const wallId = f
    .floor()
    .rooms.find((room) => room.id === f.a)
    .faces.find((face) => face.id === f.faceA).wallId;
  f.apply({
    type: 'set_property',
    floorId: f.floorId,
    wallId,
    property: 'wall_height',
    value: 2.8,
  });
  f.apply({
    type: 'set_defaults',
    floorId: f.floorId,
    roomId: f.b,
    property: 'wall_height',
    value: 3,
  });
  assert.equal(f.floor().walls.find((wall) => wall.id === wallId).properties.wall_height, 2.8);
});

test('shared thickness change anchors the active face and moves only its opposite piece', () => {
  const f = staggered();
  const wallId = f
    .floor()
    .rooms.find((room) => room.id === f.a)
    .faces.find((face) => face.id === f.faceA).wallId;
  const a = f.floor().rooms.find((room) => room.id === f.a);
  f.apply({
    type: 'set_property',
    floorId: f.floorId,
    wallId,
    activeRoomId: f.a,
    property: 'wall_thickness',
    value: 0.25,
  });
  assert.deepEqual(
    originalVertices(f.floor().rooms.find((room) => room.id === f.a)),
    originalVertices(a)
  );
  assert.ok(
    f
      .floor()
      .rooms.find((room) => room.id === f.b)
      .vertices.some((vertex) => Math.abs(vertex.y - 3.25) < 1e-6)
  );
});

test('explicit unknown height and false custom answers do not fall back through inheritance', () => {
  const f = fixture({
    properties: { soundproof: { scope: 'physical_wall', inherit: true, fallback: true } },
  });
  f.room({ x: 0, y: 0, width: 4, height: 3 });
  const wallId = f.floor().walls[0].id;
  f.apply({ type: 'set_defaults', floorId: f.floorId, property: 'wall_height', value: 3 });
  f.apply({
    type: 'set_property',
    floorId: f.floorId,
    wallId,
    property: 'wall_height',
    value: null,
  });
  f.apply({
    type: 'set_property',
    floorId: f.floorId,
    wallId,
    property: 'soundproof',
    value: false,
  });
  assert.equal(f.floor().walls[0].properties.wall_height, null);
  assert.equal(f.floor().walls[0].properties.soundproof, false);
});

test('scope cancellation reverts sibling geometry but preserves earlier independent floor answers', () => {
  const f = staggered();
  f.session.beginScope({ id: 'floor' });
  f.apply(
    { type: 'set_values', floorId: f.floorId, values: { note: 'Keep' } },
    { scopeId: 'floor' }
  );
  const beforeChild = f.session.getSnapshot();
  f.session.beginScope({ id: 'room', parentScopeId: 'floor', subject: { type: 'room', id: f.a } });
  f.apply(
    { type: 'resize_face', floorId: f.floorId, faceId: f.faceA, distance: 0.2 },
    { scopeId: 'room' }
  );
  f.apply(
    { type: 'set_values', floorId: f.floorId, roomId: f.a, values: { paint: 'Cream' } },
    { scopeId: 'room' }
  );
  assert.equal(f.session.cancelScope('room').status, 'cancelled');
  assert.deepEqual(f.session.getSnapshot(), beforeChild);
  assert.equal(f.session.cancelScope('floor').status, 'cancelled');
  assert.equal(f.floor().values.note, undefined);
});

test('child Save feeds its parent draft and parent Cancel discards it', () => {
  const f = staggered();
  const before = f.session.getSnapshot();
  f.session.beginScope({ id: 'floor' });
  f.session.beginScope({ id: 'room', parentScopeId: 'floor' });
  f.apply(
    { type: 'resize_face', floorId: f.floorId, faceId: f.faceA, distance: 0.2 },
    { scopeId: 'room' }
  );
  assert.equal(f.session.acceptScope('room').status, 'accepted');
  assert.equal(f.session.cancelScope('floor').status, 'cancelled');
  assert.deepEqual(f.session.getSnapshot(), before);
});

test('previews are immutable, session-owned, revision-checked and retired with editors', () => {
  const f = fixture();
  f.session.beginScope({ id: 'floor' });
  const proposal = f.session.preview(
    { type: 'set_values', floorId: f.floorId, values: { note: 'Proposed' } },
    { scopeId: 'floor' }
  );
  proposal.snapshot.floors[0].values.note = 'Tampered';
  assert.equal(f.floor().values.note, undefined);
  assert.equal(f.session.commit(proposal).status, 'applied');
  assert.equal(f.floor().values.note, 'Proposed');
  assert.equal(f.session.commit(proposal).issues[0].code, 'stale_proposal');
  const retired = f.session.preview(
    { type: 'set_values', floorId: f.floorId, values: { note: 'Late' } },
    { scopeId: 'floor' }
  );
  f.session.cancelScope('floor');
  assert.equal(f.session.commit(retired).status, 'conflict');
});

test('readonly sessions reject operations without opening scopes', () => {
  const session = createBuildingPlanSession({ readOnly: true });
  assert.equal(session.apply({ type: 'create_floor' }).issues[0].code, 'readonly');
  assert.equal(session.beginScope({ id: 'floor' }).status, 'blocked');
  assert.equal(session.getSnapshot().floors.length, 0);
});

test('ordinary stretches keep opening width and distance from the unchanged end', () => {
  const f = fixture();
  const roomId = f.room({ x: 0, y: 0, width: 5, height: 3 });
  const wallId = originalFaces(f.floor().rooms[0])[0].wallId;
  f.apply({
    type: 'create_opening',
    floorId: f.floorId,
    wallId,
    kind: 'door',
    offset: 1,
    width: 0.9,
    height: 2,
  });
  f.apply({
    type: 'resize_room',
    floorId: f.floorId,
    roomId,
    rectangle: { x: -1, y: 0, width: 6, height: 3 },
  });
  const opening = f.floor().walls.find((wall) => wall.id === wallId).doors[0];
  assert.equal(opening.width, 0.9);
  assert.equal(opening.offset, 2);
  const before = f.session.getSnapshot();
  const invalid = f.session.apply({
    type: 'resize_room',
    floorId: f.floorId,
    roomId,
    rectangle: { x: -1, y: 0, width: 1, height: 3 },
  });
  assert.equal(invalid.status, 'conflict');
  assert.deepEqual(f.session.getSnapshot(), before);
});

test('construction split and join preserve distinct facing extents, questions and opening identities', () => {
  const f = fixture();
  f.room({ x: 0, y: 0, width: 5, height: 3 });
  const face = originalFaces(f.floor().rooms[0])[0];
  const wallId = face.wallId;
  const openingId = f.apply({
    type: 'create_opening',
    floorId: f.floorId,
    wallId,
    kind: 'door',
    offset: 3,
    width: 0.9,
  }).created.id;
  f.apply({
    type: 'set_values',
    floorId: f.floorId,
    faceId: face.id,
    scope: 'wall_face',
    values: { finish: 'paint' },
  });
  const before = f.session.getSnapshot();
  const split = f.session.apply({ type: 'split_wall', floorId: f.floorId, wallId, offset: 2.5 });
  assert.equal(split.status, 'applied', JSON.stringify(split.issues));
  let floor = f.floor();
  const other = floor.walls.find(
    (wall) => wall.id !== wallId && wall.lineage?.splitFromWallId === wallId
  );
  assert.equal(other.doors[0].id, openingId);
  assert.equal(other.doors[0].offset, 0.5);
  f.apply({ type: 'rejoin_cut', floorId: f.floorId, cutId: split.created.id });
  floor = f.floor();
  const portions = floor.rooms[0].faces.filter((entry) => entry.wallId === wallId);
  assert.equal(portions.length, 1);
  const extents = portions.map((entry) => entry.bindings[0].interval).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(extents, [[0, 5]]);
  assert.ok(portions.every((entry) => entry.values.finish === 'paint'));
  assert.equal(floor.walls.find((wall) => wall.id === wallId).doors[0].id, openingId);
  assert.equal(f.session.undo().status, 'undone');
  assert.equal(f.session.undo().status, 'undone');
  assert.deepEqual(f.session.getSnapshot(), before);
});

test('bounded size preservation propagates only through the explicitly supplied room group', () => {
  const f = fixture();
  const a = f.room({ x: 0, y: 0, width: 5, height: 3 });
  const b = f.room({ x: 5.2, y: 0, width: 4, height: 3 });
  const c = f.room({ x: 9.4, y: 0, width: 4, height: 3 });
  let floor = f.floor();
  const faceA = originalFaces(floor.rooms[0])[1].id;
  f.apply({
    type: 'bind_faces',
    floorId: f.floorId,
    referenceFaceId: faceA,
    faceId: originalFaces(floor.rooms[1])[3].id,
  });
  floor = f.floor();
  f.apply({
    type: 'bind_faces',
    floorId: f.floorId,
    referenceFaceId: originalFaces(floor.rooms[1])[1].id,
    faceId: originalFaces(floor.rooms[2])[3].id,
  });
  const before = f.session.getSnapshot();
  const operation = {
    type: 'resize_preserve_group',
    floorId: f.floorId,
    faceId: faceA,
    distance: 0.5,
    affectedRoomIds: [a, b],
    preserveRoomIds: [b],
  };
  const denied = f.session.apply(operation);
  assert.equal(denied.status, 'conflict');
  assert.equal(denied.issues[0].code, 'outside_affected_group');
  assert.deepEqual(f.session.getSnapshot(), before);
  f.apply({ ...operation, affectedRoomIds: [a, b, c], preserveRoomIds: [b, c] });
  floor = f.floor();
  assert.ok(Math.abs(roomBounds(floor.rooms[1]).width - 4) < 1e-6);
  assert.ok(Math.abs(roomBounds(floor.rooms[2]).width - 4) < 1e-6);
  assert.ok(Math.abs(roomBounds(floor.rooms[2]).x - 9.9) < 1e-6);
  assert.equal(f.session.undo().status, 'undone');
  assert.deepEqual(f.session.getSnapshot(), before);
});

test('room snapping reattaches a moved room to the stationary subject without duplicating its evidence', () => {
  const f = staggered();
  const stationaryId = originalFaces(f.floor().rooms[0])[2].wallId;
  f.apply({ type: 'move_room', floorId: f.floorId, roomId: f.b, delta: { x: 10, y: 0 } });
  f.apply({ type: 'move_room', floorId: f.floorId, roomId: f.b, delta: { x: -10, y: 0 } });
  assert.equal(originalFaces(f.floor().rooms[1])[0].wallId, stationaryId);
  assert.equal(f.floor().walls.length, 9);
});

test('physical owners preserve distinct overrides and reject a lossy Rejoin', () => {
  const f = fixture();
  f.room({ x: 0, y: 0, width: 5, height: 3 });
  const wallId = f.floor().walls[0].id;
  const cut = f.apply({ type: 'split_wall', floorId: f.floorId, wallId, offset: 2.5 }).created.id;
  const other = f
    .floor()
    .walls.find((w) => w.id !== wallId && w.lineage?.splitFromWallId === wallId);
  f.apply({ type: 'set_defaults', floorId: f.floorId, property: 'wall_height', value: 2.4 });
  f.apply({
    type: 'set_property',
    floorId: f.floorId,
    wallId: other.id,
    property: 'wall_height',
    value: 3,
  });
  const before = f.session.getSnapshot();
  const rejected = f.session.apply({ type: 'rejoin_cut', floorId: f.floorId, cutId: cut });
  assert.equal(rejected.status, 'conflict');
  assert.deepEqual(f.session.getSnapshot(), before);
  assert.equal(f.floor().walls.find((w) => w.id === wallId).properties.wall_height, 2.4);
  assert.equal(other.segments.length, 1);
  f.apply({
    type: 'set_property',
    floorId: f.floorId,
    wallId: other.id,
    property: 'wall_height',
    reset: true,
  });
  f.apply({ type: 'rejoin_cut', floorId: f.floorId, cutId: cut });
  assert.equal(f.floor().walls.length, 4);
  assert.equal(f.floor().walls.find((w) => w.id === wallId).properties.wall_height, 2.4);
});

test('physical thickness anchors its captured face and explicit unknown retains valid geometry', () => {
  const f = fixture();
  f.room({ x: 0, y: 0, width: 5, height: 3 });
  const wall = f.floor().walls[0],
    before = f.floor().rooms[0].vertices;
  f.apply({
    type: 'set_property',
    floorId: f.floorId,
    wallId: wall.id,
    property: 'wall_thickness',
    value: 0.4,
  });
  assert.deepEqual(f.floor().rooms[0].vertices, before);
  assert.equal(f.floor().walls[0].properties.wall_thickness, 0.4);
  const geometry = f.floor().walls[0].segments[0];
  f.apply({
    type: 'set_property',
    floorId: f.floorId,
    wallId: wall.id,
    property: 'wall_thickness',
    value: null,
  });
  assert.equal(f.floor().walls[0].properties.wall_thickness, null);
  assert.deepEqual(f.floor().walls[0].segments[0].start, geometry.start);
  assert.deepEqual(f.session.validate(), []);
});

test('observation writes cannot target another floor and malformed room topology is rejected', () => {
  const f = fixture();
  const roomId = f.room({ x: 0, y: 0, width: 5, height: 3 });
  const floorB = f.apply({ type: 'create_floor' }).created.id;
  const before = f.session.getSnapshot();
  const result = f.session.apply({
    type: 'add_observation',
    floorId: floorB,
    subject: { type: 'room', id: roomId },
  });
  assert.equal(result.status, 'conflict');
  assert.ok(result.issues.some((issue) => issue.code === 'unknown_operation'));
  assert.deepEqual(f.session.getSnapshot(), before);
  const malformed = structuredClone(before);
  malformed.floors[0].rooms[0].edges[0].endId = 'missing-vertex';
  assert.ok(
    validateBuildingPlanSnapshot(malformed).some((issue) => issue.code === 'invalid_room_topology')
  );
});
