import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

const round = (value) => Math.round(value * 1000) / 1000 + 0;

/** The example on today's engine or the derived core. */
function example(derived = true) {
  const f = createBuildingPlanExample();
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    createId: () => `k-${++serial}`,
    derivedCommands: derived,
  });
  const floor = () => session.getSnapshot().floors[0];
  const moveCorner = (roomIndex, [x, y], point) => {
    const room = floor().rooms[roomIndex];
    const vertex = room.vertices.find((v) => v.x === x && v.y === y);
    return session.apply({
      type: 'move_corner',
      floorId: f.floorId,
      roomId: room.id,
      vertexId: vertex.id,
      point,
    });
  };
  return { f, session, floor, moveCorner };
}
const outline = (room) => room.vertices.map((v) => [round(v.x), round(v.y)]);

test('a corner moved along its wall gives the same plan as today', () => {
  const [now, derived] = [example(false), example()];
  for (const t of [now, derived]) {
    const result = t.moveCorner(0, [5, 3], { x: 5.3, y: 3 });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    assert.deepEqual(t.session.validate(), []);
  }
  assert.deepEqual(derived.floor().rooms.map(outline), now.floor().rooms.map(outline));
  assert.deepEqual(
    derived.floor().walls.map((wall) => wall.autoLabel),
    now.floor().walls.map((wall) => wall.autoLabel)
  );
});

test('a shared corner turns the wall: the neighbour follows on the parallel line (F8)', () => {
  const [now, derived] = [example(false), example()];
  for (const t of [now, derived]) {
    const result = t.moveCorner(0, [5, 3], { x: 5, y: 3.5 });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    assert.deepEqual(t.session.validate(), []);
  }
  // Same outlines as today: A's run turns about (0,3); B's facing stretch moves to the parallel
  // line, its corner where its own lines meet, with a square return at A's east wall.
  assert.deepEqual(derived.floor().rooms.map(outline), now.floor().rooms.map(outline));
  const floor = derived.floor();
  const [a, b] = floor.rooms;
  const shared = floor.walls.filter((wall) => wall.sides.filter((s) => s.roomId).length === 2);
  assert.ok(
    shared.some((wall) => wall.autoLabel === 'W3'),
    'W3 stays the shared wall'
  );
  assert.ok(
    shared.some((wall) => wall.autoLabel.startsWith('W2')),
    "B's return meets A's east wall: that wall continues over the contact (F2)"
  );
  assert.equal(a.id, now.floor().rooms[0].id);
  assert.ok(b.vertices.some((v) => round(v.x) === 5.2));
});

test('an exterior corner turns its two walls; rows keep their walls', () => {
  const t = example();
  const before = t.floor();
  const result = t.moveCorner(1, [8, 6.2], { x: 8.5, y: 6.7 });
  assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  assert.deepEqual(t.session.validate(), []);
  const floor = t.floor();
  assert.deepEqual(
    floor.walls.map((wall) => wall.autoLabel).sort(),
    before.walls.map((wall) => wall.autoLabel).sort()
  );
  assert.ok(floor.rooms[1].vertices.some((v) => v.x === 8.5 && v.y === 6.7));
});

test('refusals: an unknown corner, a corner that turns the room inside out', () => {
  const t = example();
  const room = t.floor().rooms[0];
  const unknown = t.session.apply({
    type: 'move_corner',
    floorId: t.f.floorId,
    roomId: room.id,
    vertexId: 'nowhere',
    point: { x: 1, y: 1 },
  });
  assert.equal(unknown.issues[0].code, 'invalid_corner');
  const inverted = t.moveCorner(0, [5, 3], { x: -2, y: -2 });
  assert.notEqual(inverted.status, 'applied');
  assert.equal(inverted.issues[0].code, 'invalid_room_geometry');
});
