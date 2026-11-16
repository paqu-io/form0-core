import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

const r3 = (value) => Math.round(value * 1000) / 1000 + 0;
const outline = (room) => room.vertices.map((v) => [r3(v.x), r3(v.y)]);

/** The example on the derived core (midline), optionally with exterior walls `exterior` thick. */
function example(exterior = null) {
  const f = createBuildingPlanExample();
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    createId: () => `seat-${++serial}`,
    derivedCommands: true,
    editingPolicy: { inheritedChangePolicy: 'apply', thicknessAnchor: 'midline' },
  });
  const floor = () => session.getSnapshot().floors[0];
  const applied = (operation) => {
    const result = session.apply({ floorId: f.floorId, ...operation });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    assert.deepEqual(session.validate(), []);
  };
  if (exterior != null)
    applied({
      type: 'set_provider',
      nodeKey: 'floors',
      fieldName: 'floor_exterior_wall_thickness',
      property: 'wall_thickness',
      value: exterior,
    });
  // Room 1's east row (W2).
  const dragEast = (distance) => {
    const room = floor().rooms[0];
    const face = room.faces.find(
      (entry) => floor().walls.find((wall) => wall.id === entry.wallId).autoLabel === 'W2'
    );
    applied({ type: 'resize_face', faceId: face.id, distance });
  };
  return { session, floor, dragEast };
}

const between = (floor, a, b) =>
  floor.walls.filter(
    (wall) =>
      wall.sides.some((side) => side.roomId === a) && wall.sides.some((side) => side.roomId === b)
  );

test('a lengthened stretch that would stand in the neighbour wall lands at the contact width', () => {
  // Manual round, session 4762a5d9: exterior walls 0.5 m around their midline, so Room 2's top
  // steps from y 3.2 (shared with Room 1) to 3.35 (exterior) at x = 5. Room 1's east wall dragged
  // 2.078 m: its bottom runs on past x = 5, 0.35 m from Room 2's wall, which is 0.5 m thick.
  const t = example(0.5);
  const before = t.floor();
  const [room1, room2] = before.rooms.map((room) => room.id);
  const door = before.walls.find((wall) => wall.doors.length);
  t.dragEast(2.078);
  const floor = t.floor();
  // Room 1's new part steps down 0.15 m at x = 5, one interior wall from Room 2; Room 2 holds.
  assert.deepEqual(outline(floor.rooms[0]), [
    [0.15, 0.15],
    [6.928, 0.15],
    [6.928, 3.15],
    [5, 3.15],
    [5, 3],
    [3.15, 3],
    [3, 3],
    [3, 2.85],
    [0.15, 2.85],
  ]);
  assert.deepEqual(outline(floor.rooms[1]), [
    [3.15, 3.2],
    [5, 3.2],
    [5, 3.35],
    [6.928, 3.35],
    [7.85, 3.35],
    [7.85, 6.05],
    [3.15, 6.05],
  ]);
  // The door's wall keeps its identity; the new contact is a part of Room 2's wall in place.
  const shared = between(floor, room1, room2);
  assert.equal(shared.length, 2);
  assert.ok(shared.every((wall) => wall.exposure === 'interior'));
  assert.ok(shared.every((wall) => wall.properties.wall_thickness === 0.2));
  const kept = shared.find((wall) => wall.id === door.id);
  assert.deepEqual(
    kept?.doors.map((entry) => entry.id),
    door.doors.map((entry) => entry.id)
  );
  const added = shared.find((wall) => wall.id !== door.id);
  const w31 = before.walls.find((wall) => wall.autoLabel === 'W3.1');
  assert.equal(added.lineage?.dividedFromWallId, w31.id);
});

test('a lengthened stretch already at a contact width is not moved', () => {
  // Uniform 0.2 m walls: Room 1's bottom runs on at 0.2 m from Room 2's top, a contact.
  const t = example();
  t.dragEast(2);
  const room1 = t.floor().rooms[0];
  assert.ok(
    room1.vertices.every((v) => [0, 3].includes(r3(v.y))),
    JSON.stringify(outline(room1))
  );
});

test('undo gives back the plan before a seated drag', () => {
  const t = example(0.5);
  const before = t.session.getSnapshot();
  t.dragEast(2.078);
  assert.equal(t.session.undo().status, 'undone');
  assert.deepEqual(t.session.getSnapshot(), before);
});
