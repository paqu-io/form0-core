import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession, expandBuildingPlanSchema } from '../src/index.js';
import { createBuildingPlanSnapshot } from '../src/building-plan/model.js';
import { sharedRows } from './helpers/building-plan-derive.js';

const meta = expandBuildingPlanSchema({
  form: { elements: [{ type: 'BuildingPlanSection', key: 'plan', data_name: 'plan' }] },
}).buildingPlanMeta[0];

/** A session on the derived core with one floor (exterior/interior thickness) and room A. */
function fixture(exterior = 0.2, interior = 0.2) {
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: createBuildingPlanSnapshot(),
    properties: meta.properties,
    createId: () => `room-${++serial}`,
    derivedCommands: true,
    editingPolicy: { inheritedChangePolicy: 'apply', copyCustomAnswersAutomatically: true },
  });
  const apply = (operation) => {
    const result = session.apply({ floorId, ...operation });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    assert.deepEqual(session.validate(), []);
    return result;
  };
  const floorId = session.apply({
    type: 'create_floor',
    values: { floor_exterior_wall_thickness: exterior, floor_interior_wall_thickness: interior },
  }).created.id;
  const roomA = apply({ type: 'create_room', rectangle: { x: 0, y: 0, width: 5, height: 3 } })
    .created.id;
  const floor = () => session.getSnapshot().floors[0];
  const labels = () => floor().walls.map((wall) => wall.autoLabel);
  return { session, apply, floorId, roomA, floor, labels };
}

const room = (floor, id) => floor.rooms.find((entry) => entry.id === id);

test('a room created one thickness from another shares a wall at once; walls keep identity', () => {
  const f = fixture();
  const w3 = f.floor().walls.find((wall) => wall.autoLabel === 'W3');
  const roomB = f.apply({ type: 'create_room', rectangle: { x: 3, y: 3.2, width: 5, height: 3 } })
    .created.id;
  const floor = f.floor();
  const { wallId } = sharedRows(floor, room(floor, f.roomA), room(floor, roomB));
  assert.equal(floor.walls.find((wall) => wall.id === wallId).autoLabel, 'W3.1');
  assert.equal(floor.walls.find((wall) => wall.id === w3.id).exposure, 'exterior', 'W3 keeps A');
  assert.deepEqual(f.labels(), ['W1', 'W2', 'W3', 'W3.1', 'W4', 'W5', 'W6', 'W7', 'W8']);
});

test('snapping seats the moved room at the shared thickness; rooms in place do not move', () => {
  const f = fixture(0.5, 0.2);
  const roomB = f.apply({ type: 'create_room', rectangle: { x: 3, y: 4, width: 5, height: 3 } })
    .created.id;
  // Rooms in place keep their corners; an automatic station may mark the new contact's end.
  const corners = (floor) => room(floor, f.roomA).vertices.filter((v) => !v.physicalBoundaryId);
  const before = corners(f.floor());
  f.apply({
    type: 'move_room',
    roomId: roomB,
    delta: { x: 0, y: -0.7 },
    attachmentTolerance: 0.25,
  });
  const floor = f.floor();
  assert.deepEqual(corners(floor), before);
  assert.ok(Math.abs(Math.min(...room(floor, roomB).vertices.map((v) => v.y)) - 3.2) < 1e-9);
  const { wallId } = sharedRows(floor, room(floor, f.roomA), room(floor, roomB));
  assert.equal(floor.walls.find((wall) => wall.id === wallId).properties.wall_thickness_m, 0.2);
});

test('Keep previous values seats at the existing width and stores it on the shared piece', () => {
  const f = fixture(0.5, 0.2);
  const roomB = f.apply({ type: 'create_room', rectangle: { x: 3, y: 4, width: 5, height: 3 } })
    .created.id;
  f.apply({
    type: 'move_room',
    roomId: roomB,
    delta: { x: 0, y: -0.7 },
    attachmentTolerance: 0.25,
    keepContactThickness: true,
  });
  const floor = f.floor();
  assert.ok(Math.abs(Math.min(...room(floor, roomB).vertices.map((v) => v.y)) - 3.5) < 1e-9);
  const shared = floor.walls.find(
    (wall) => wall.id === sharedRows(floor, room(floor, f.roomA), room(floor, roomB)).wallId
  );
  assert.equal(shared.overrides.wall_thickness_m, 0.5);
});

test('moving a room away and back keeps every wall; Undo restores the plan', () => {
  const f = fixture();
  const roomB = f.apply({ type: 'create_room', rectangle: { x: 3, y: 3.2, width: 5, height: 3 } })
    .created.id;
  const start = f.session.getSnapshot();
  const walls = (floor) => floor.walls.map((wall) => `${wall.id}:${wall.autoLabel}`).sort();
  f.apply({ type: 'move_room', roomId: roomB, delta: { x: 0.4, y: 0 }, attach: false });
  f.apply({ type: 'move_room', roomId: roomB, delta: { x: -0.4, y: 0 }, attach: false });
  assert.deepEqual(walls(f.floor()), walls(start.floors[0]));
  assert.equal(f.session.undo().status, 'undone');
  assert.equal(f.session.undo().status, 'undone');
  assert.deepEqual(f.session.getSnapshot(), start);
});

test('a door on a shared wall stays with the room that stays; removing a room keeps it too', () => {
  const f = fixture();
  const roomB = f.apply({ type: 'create_room', rectangle: { x: 3, y: 3.2, width: 5, height: 3 } })
    .created.id;
  const { wallId } = sharedRows(f.floor(), room(f.floor(), f.roomA), room(f.floor(), roomB));
  const doorId = f.apply({
    type: 'create_opening',
    wallId,
    kind: 'door',
    offset: 0.5,
    width: 0.9,
    height: 2,
  }).created.id;
  const hostRoom = (floor) => {
    const wall = floor.walls.find((entry) => entry.doors.some((door) => door.id === doorId));
    return wall?.sides.find((side) => side.roomId)?.roomId;
  };
  const moved = createBuildingPlanSession({
    snapshot: f.session.getSnapshot(),
    properties: meta.properties,
    derivedCommands: true,
  });
  const away = moved.apply({
    floorId: f.floorId,
    type: 'move_room',
    roomId: roomB,
    delta: { x: 0, y: 2 },
    attach: false,
  });
  assert.equal(away.status, 'applied', JSON.stringify(away.issues));
  assert.equal(hostRoom(moved.getSnapshot().floors[0]), f.roomA);

  f.apply({ type: 'remove_room', roomId: roomB });
  const floor = f.floor();
  assert.deepEqual(
    floor.walls.map((wall) => wall.exposure),
    floor.walls.map(() => 'exterior')
  );
  assert.equal(hostRoom(floor), f.roomA);
  assert.ok(floor.walls.every((wall) => wall.sides.every((side) => side.roomId !== roomB)));
});
