import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import { createBuildingPlanSnapshot } from '../src/building-plan/model.js';
import { derivedSpecifications, translateRoom, writeBack } from './helpers/building-plan-derive.js';

const example = createBuildingPlanExample();
const specifications = derivedSpecifications(example.meta);
const floor = example.snapshot.floors[0];
const [roomA, roomB] = floor.rooms;
const byLabel = (plan, label) => plan.walls.find((wall) => wall.autoLabel === label);
const refusal = (run) => {
  try {
    run();
  } catch (error) {
    return error.issues?.[0]?.code;
  }
  return null;
};

/** Two rooms exactly one interior thickness apart, created without binding their faces. */
function unboundFloor() {
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: createBuildingPlanSnapshot(),
    properties: example.meta.properties,
    createId: () => `unbound-${++serial}`,
  });
  const floorId = session.apply({
    type: 'create_floor',
    values: { floor_interior_wall_thickness: 0.2, floor_exterior_wall_thickness: 0.2 },
  }).created.id;
  for (const rectangle of [
    { x: 0, y: 0, width: 5, height: 3 },
    { x: 3, y: 3.2, width: 5, height: 3 },
  ])
    session.apply({ type: 'create_room', floorId, rectangle });
  return session.getSnapshot().floors[0];
}

test('an unbound contact joins its two walls; the lower label survives, as bind_faces does', () => {
  const stored = unboundFloor();
  const [w3, w5] = ['W3', 'W5'].map((label) => byLabel(stored, label));
  const result = writeBack(stored, specifications);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.joins, [{ survivorId: w3.id, absorbedId: w5.id }]);
  const shared = result.floor.walls.filter((wall) => wall.exposure === 'interior');
  assert.deepEqual(
    shared.map((wall) => [wall.id, wall.autoLabel]),
    [[w3.id, 'W3']]
  );
  // The remainders copy the survivor and are numbered along its axis, as today.
  assert.deepEqual(
    ['W3.1', 'W3.2'].map(
      (label) => byLabel(result.floor, label).sides.find((s) => s.roomId).roomId
    ),
    [stored.rooms[1].id, stored.rooms[0].id]
  );
  // Each room gets an automatic station where the contact ends on its edge.
  for (const [room, x] of [
    [result.floor.rooms[0], 3],
    [result.floor.rooms[1], 5],
  ]) {
    const station = room.vertices.find((vertex) => vertex.physicalBoundaryId);
    assert.ok(station && Math.abs(station.x - x) < 1e-9, `station at x = ${x}`);
  }
});

test('a join keeps every answer or is refused; a preferred room keeps its wall', () => {
  const stored = unboundFloor();
  const [w3, w5] = ['W3', 'W5'].map((label) => byLabel(stored, label));
  const heights = (a, b) => (primary) => {
    if (a != null) primary.subjects.get(w3.id).overrides.wall_height_m = a;
    if (b != null) primary.subjects.get(w5.id).overrides.wall_height_m = b;
  };
  assert.equal(
    refusal(() => writeBack(stored, specifications, { edit: heights(2.5, 2.7) })),
    'conflicting_wall_properties'
  );
  const merged = writeBack(stored, specifications, { edit: heights(null, 2.7) }).floor;
  assert.equal(byLabel(merged, 'W3').overrides.wall_height_m, 2.7);
  const preferred = writeBack(stored, specifications, { preferredRoomIds: [stored.rooms[1].id] });
  assert.deepEqual(preferred.joins, [{ survivorId: w5.id, absorbedId: w3.id }]);
});

test('a wall divides when its rooms change: copies keep answers and custom rows', () => {
  const shared = byLabel(floor, 'W3');
  const result = writeBack(floor, specifications, {
    edit(primary) {
      const subject = primary.subjects.get(shared.id);
      subject.values.material = 'Concrete';
      subject.repeatable = { inspections: [{ id: 'row-1', values: { note: 'checked' } }] };
      translateRoom(primary, roomB.id, 0.4);
    },
  });
  assert.deepEqual(result.issues, []);
  const [division] = result.divisions;
  assert.equal(division.source.id, shared.id);
  assert.ok(
    division.walls.some((wall) => wall.id === shared.id),
    'The piece holding the reference span keeps it.'
  );
  const copies = division.walls.filter((wall) => wall.id !== shared.id);
  assert.ok(copies.length >= 1);
  for (const copy of copies) {
    assert.equal(copy.values.material, 'Concrete');
    assert.equal(copy.repeatable.inspections[0].values.note, 'checked');
    assert.notEqual(copy.repeatable.inspections[0].id, 'row-1', 'Custom rows get new IDs.');
    assert.ok(copy.sides.every((side) => !shared.sides.some((old) => old.id === side.id)));
    assert.equal(copy.lineage.dividedFromWallId, shared.id);
    assert.match(copy.autoLabel, /^W3\.\d+$/);
  }
});

test('an opening keeps its place when its wall divides, and may not cross a boundary', () => {
  const shared = byLabel(floor, 'W3');
  const position = (wall) => {
    const [segment] = wall.segments;
    const [door] = wall.doors;
    const length = Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y);
    const t = (door.offset + door.width / 2) / length;
    return segment.start.x + (segment.end.x - segment.start.x) * t;
  };
  const moved = writeBack(floor, specifications, {
    edit: (primary) => translateRoom(primary, roomB.id, 0.4),
  });
  assert.ok(Math.abs(position(byLabel(moved.floor, 'W3')) - position(shared)) < 1e-9);
  const crossing = () =>
    writeBack(floor, specifications, { edit: (primary) => translateRoom(primary, roomB.id, 1) });
  assert.equal(refusal(crossing), 'opening_crosses_split');
});

test('automatic divisions join their neighbours again and stations follow the pieces', () => {
  const remainders = ['W3.1', 'W3.2'].map((label) => byLabel(floor, label).id);
  const moved = writeBack(floor, specifications, {
    edit: (primary) => translateRoom(primary, roomB.id, 0.4),
  });
  assert.deepEqual(moved.issues, []);
  // The copies of the shared wall on each side join the remainders, which keep their IDs.
  assert.deepEqual(moved.joins.map((join) => join.survivorId).sort(), [...remainders].sort());
  assert.deepEqual(
    ['W3.1', 'W3.2'].map((label) => byLabel(moved.floor, label).id),
    remainders
  );
  const stations = (room) => room.vertices.filter((vertex) => vertex.physicalBoundaryId);
  const southA = stations(moved.floor.rooms[0]);
  assert.deepEqual(
    southA.map((vertex) => vertex.x),
    [3.4],
    'The old station at x = 3 left; a new one marks the contact end.'
  );
  assert.equal(moved.floor.rooms[0].vertices.length, roomA.vertices.length);
});

test('a wall without pieces retires only when nothing would be lost', () => {
  const w1 = byLabel(floor, 'W1');
  const drop = (primary) => {
    primary.anchors = primary.anchors.filter((anchor) => anchor.subjectId !== w1.id);
  };
  const retired = writeBack(floor, specifications, { edit: drop });
  assert.deepEqual(retired.retired, [w1.id]);
  assert.equal(retired.created.length, 1, 'The bare edge gets a new wall.');
  const answered = () =>
    writeBack(floor, specifications, {
      edit(primary) {
        drop(primary);
        primary.subjects.get(w1.id).values.material = 'Brick';
      },
    });
  assert.equal(refusal(answered), 'wall_retirement_conflict');
});

test('a new room without anchors gets new walls, rows and the next labels', () => {
  const result = writeBack(floor, specifications, {
    edit(primary) {
      const ids = ['n1', 'n2', 'n3', 'n4'];
      primary.rooms.push({
        id: 'new-room',
        values: {},
        defaults: {},
        vertices: [
          { id: ids[0], x: 10, y: 0 },
          { id: ids[1], x: 13, y: 0 },
          { id: ids[2], x: 13, y: 3 },
          { id: ids[3], x: 10, y: 3 },
        ],
        edges: ids.map((id, i) => ({ id: `e-${id}`, startId: id, endId: ids[(i + 1) % 4] })),
        columns: [],
        beams: [],
        objects: [],
      });
    },
  });
  assert.deepEqual(result.issues, []);
  assert.equal(result.created.length, 4);
  const room = result.floor.rooms.find((entry) => entry.id === 'new-room');
  assert.equal(room.faces.length, 4);
  const labels = result.created.map((id) => result.floor.walls.find((w) => w.id === id).autoLabel);
  assert.deepEqual(labels, ['W9', 'W10', 'W11', 'W12']);
});
