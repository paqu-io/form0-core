import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import { polygonArea } from '../src/building-plan/geometry.js';

// Attaching may add adjacency boundary vertices on existing edges, but every original
// corner keeps its position and the room outline keeps its area.
function assertUnchanged(before, after) {
  for (const [index, room] of before.entries()) {
    for (const corner of room.vertices)
      assert.deepEqual(
        after[index].vertices.find((vertex) => vertex.id === corner.id),
        corner,
        `Room ${index + 1} keeps corner ${corner.id}.`
      );
    assert.ok(Math.abs(polygonArea(after[index].vertices) - polygonArea(room.vertices)) < 1e-9);
  }
}

// Example plan with 500 mm exterior and 200 mm interior walls. Room 1's east face is
// x = 5 and room 2's south face is y = 3.2, so the corner between them is free from
// x = 5.5 and below y = 2.7 (their exterior walls' outer faces).
function fixture(policy) {
  const f = createBuildingPlanExample();
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    createId: () => `seat-${++serial}`,
    editingPolicy: { inheritedChangePolicy: policy },
  });
  const exterior = session.apply({
    floorId: f.floorId,
    type: 'set_provider',
    nodeKey: 'floors',
    fieldName: 'floor_exterior_wall_thickness',
    property: 'wall_thickness_m',
    value: 0.5,
  });
  assert.equal(exterior.status, 'applied', JSON.stringify(exterior.issues));
  const attach = (rectangle, decision) => {
    let result = session.apply({
      floorId: f.floorId,
      type: 'create_room',
      attach: true,
      attachmentTolerance: 0.25,
      rectangle,
    });
    for (let question = 0; result.status === 'pending' && question < 4; question++)
      result = session.resolveUIRequest(result.uiOperations[0].params.requestId, {
        value: decision,
      });
    return result;
  };
  const rooms = () => session.getSnapshot().floors[0].rooms;
  const bounds = (room) => {
    const xs = room.vertices.map((v) => v.x),
      ys = room.vertices.map((v) => v.y);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(
      (value) => Math.round(value * 1e6) / 1e6
    );
  };
  return { session, attach, rooms, bounds };
}

const sharedWidths = (plan, roomId) =>
  plan.floors[0].walls
    .filter((wall) => wall.sides.filter((side) => side.roomId).length === 2)
    .filter((wall) => wall.sides.some((side) => side.roomId === roomId))
    .map((wall) => wall.properties.wall_thickness_m);

test('attaching a room keeps rooms in place and seats it at the shared interior thickness', () => {
  const f = fixture('ask');
  const before = f.rooms();
  const result = f.attach({ x: 5.5, y: 0, width: 2.5, height: 2.7 }, 'apply');
  assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  const [room1, room2, room3] = f.rooms();
  assertUnchanged(before, [room1, room2]);
  assert.deepEqual(f.bounds(room3), [5.2, 0.3, 7.7, 3], 'Room 3 moves 0.3 m, keeping its size.');
  const widths = sharedWidths(f.session.getSnapshot(), room3.id);
  assert.ok(widths.length >= 2 && widths.every((width) => width === 0.2));
  assert.deepEqual(f.session.validate(), []);
});

test('Keep previous values seats the attached room at the kept width without moving others', () => {
  const f = fixture('ask');
  const before = f.rooms();
  const result = f.attach({ x: 5.5, y: 0, width: 2.5, height: 2.7 }, 'preserve');
  assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  const [room1, room2, room3] = f.rooms();
  assertUnchanged(before, [room1, room2]);
  assert.deepEqual(f.bounds(room3), [5.5, 0, 8, 2.7], 'Room 3 stays 500 mm away.');
  const plan = f.session.getSnapshot();
  const shared = plan.floors[0].walls.filter(
    (wall) =>
      wall.sides.filter((side) => side.roomId).length === 2 &&
      wall.sides.some((side) => side.roomId === room3.id)
  );
  assert.ok(shared.length >= 2);
  for (const wall of shared) {
    assert.equal(wall.properties.wall_thickness_m, 0.5);
    assert.equal(wall.overrides.wall_thickness_m, 0.5, 'The kept width is an explicit override.');
  }
  assert.deepEqual(f.session.validate(), []);
});

test('a room that cannot meet both neighbours at the shared thickness is rejected', () => {
  const f = fixture('apply');
  const placed = f.session.apply({
    floorId: f.session.getSnapshot().floors[0].id,
    type: 'create_room',
    rectangle: { x: 12, y: 3.2, width: 3, height: 3 },
  });
  assert.equal(placed.status, 'applied', JSON.stringify(placed.issues));
  const before = f.session.getSnapshot();
  // Between room 2's east face (x = 8) and the new room's west face (x = 12), a 3 m
  // room touches both outer faces; 200 mm walls on both sides would need 3.6 m.
  const result = f.attach({ x: 8.5, y: 3.2, width: 3, height: 3 }, 'apply');
  assert.equal(result.status, 'conflict');
  assert.ok(result.issues.some((issue) => issue.code === 'attachment_fit_conflict'));
  assert.deepEqual(f.session.getSnapshot(), before);
});
