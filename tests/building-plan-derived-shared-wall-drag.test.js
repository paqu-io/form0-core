import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession, normalizeBuildingPlanEditingPolicy } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import { widenPlan } from '../src/building-plan/derive/shared-wall-drag.js';
import { extractBuildingPlanPrimary } from '../src/building-plan/derive/extract.js';
import { resolutionFloor } from '../src/building-plan/derive/thickness.js';
import { derivedSpecifications } from './helpers/building-plan-derive.js';

const near = (a, b) => Math.abs(a - b) < 1e-9;

/** The example (A and B share W3, with a door) on the derived core, exterior walls as given. */
function example(exterior = 0.2, editingPolicy = {}) {
  const f = createBuildingPlanExample();
  let serial = 0;
  const options = { properties: f.meta.properties, createId: () => `w-${++serial}` };
  const old = createBuildingPlanSession({ snapshot: f.snapshot, ...options });
  if (exterior !== 0.2)
    old.apply({
      type: 'set_provider',
      floorId: f.floorId,
      nodeKey: 'floors',
      fieldName: 'floor_exterior_wall_thickness',
      property: 'wall_thickness',
      value: exterior,
    });
  const session = createBuildingPlanSession({
    snapshot: old.getSnapshot(),
    ...options,
    derivedCommands: true,
    editingPolicy,
  });
  const floor = () => session.getSnapshot().floors[0];
  const apply = (operation) => {
    const result = session.apply({ floorId: f.floorId, ...operation });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    assert.deepEqual(session.validate(), []);
    return result;
  };
  return { f, session, floor, apply };
}
const top = (room) => Math.max(...room.vertices.filter((v) => v.x > 3.5).map((v) => v.y));
const bottom = (room) =>
  Math.min(...room.vertices.filter((v) => v.x > 3 - 1e-9 && v.x < 5 + 1e-9).map((v) => v.y));
/** The wall of the room edge on line y that covers x = 4. */
const wallOf = (floor, room, y) => {
  const covers = (edge) => {
    const ends = [edge.startId, edge.endId].map((id) => room.vertices.find((p) => p.id === id));
    const xs = ends.map((p) => p.x);
    return ends.every((p) => near(p.y, y)) && Math.min(...xs) <= 4 && Math.max(...xs) >= 4;
  };
  const face = room.faces.find((entry) =>
    entry.edgeIds.some((id) => covers(room.edges.find((edge) => edge.id === id)))
  );
  return floor.walls.find((wall) => wall.id === face.wallId);
};

test('widen (default): away from the neighbour the wall widens; B keeps its face', () => {
  const t = example();
  const bBefore = t.floor().rooms[1].vertices;
  t.apply({ type: 'resize_face', faceId: t.f.faceA, distance: -0.2 });
  const floor = t.floor();
  const [a, b] = floor.rooms;
  assert.deepEqual(b.vertices, bBefore);
  assert.ok(near(top(a), 2.8));
  const wall = wallOf(floor, a, 2.8);
  assert.equal(wall.exposure, 'interior');
  assert.equal(wall.properties.wall_thickness, 0.4);
  assert.equal(wall.overrides.wall_thickness, 0.4, 'the widened width is explicit');
});

test('widen: towards the neighbour the whole wall moves, as move_wall does', () => {
  const [w, m] = [example(), example(0.2, { sharedWallDrag: 'move_wall' })];
  for (const t of [w, m]) t.apply({ type: 'resize_face', faceId: t.f.faceA, distance: 0.2 });
  assert.deepEqual(
    w.floor().rooms.map((room) => room.vertices.map((v) => [v.x, v.y])),
    m.floor().rooms.map((room) => room.vertices.map((v) => [v.x, v.y]))
  );
  const policy = example(0.2, { sharedWallDrag: 'move_wall' });
  policy.apply({ type: 'resize_face', faceId: policy.f.faceA, distance: -0.2 });
  assert.ok(near(bottom(policy.floor().rooms[1]), 3.0), 'move_wall: B follows away from it too');
});

test('widen: past the limit the face holds; further on the room detaches, B keeps the wall', () => {
  // Exterior 0.5: both rooms' own walls need 1 m, so between 0.7 and 1 m the face holds.
  const held = example(0.5);
  held.apply({ type: 'resize_face', faceId: held.f.faceA, distance: -0.7 });
  const a = held.floor().rooms[0];
  assert.ok(near(top(a), 2.5), 'held at the 0.7 m limit');
  assert.equal(wallOf(held.floor(), a, 2.5).properties.wall_thickness, 0.7);

  const apart = example(0.5);
  apart.apply({ type: 'resize_face', faceId: apart.f.faceA, distance: -1 });
  const floor = apart.floor();
  const [roomA, roomB] = floor.rooms;
  assert.ok(near(top(roomA), 2));
  assert.ok(near(bottom(roomB), 3.2), 'B keeps its face');
  // B's side is one exterior wall again (automatic re-join keeps the longer piece's identity)
  // and it keeps the door; A's side is a new copy without it.
  const kept = wallOf(floor, roomB, 3.2);
  assert.equal(kept.exposure, 'exterior');
  assert.equal(kept.doors.length, 1, 'the room that stays keeps the door');
  const copy = wallOf(floor, roomA, 2);
  assert.equal(copy.exposure, 'exterior');
  assert.equal(copy.doors.length, 0);
});

test('the limit is the thickness field maximum when the form sets one', () => {
  const f = createBuildingPlanExample();
  const primary = extractBuildingPlanPrimary(f.snapshot.floors[0]);
  const specifications = derivedSpecifications(f.meta);
  specifications.wall_thickness = {
    ...specifications.wall_thickness,
    field: { ...specifications.wall_thickness.field, max: 0.3 },
  };
  const plan = (distance) =>
    widenPlan(primary, resolutionFloor(primary), specifications, {
      subjectId: f.wallId,
      roomIds: [primary.rooms[0].id, primary.rooms[1].id],
      width: 0.2,
      distance,
    });
  assert.deepEqual(plan(-0.05), { kind: 'widen', distance: -0.05, width: 0.25 });
  assert.equal(plan(-0.15).kind, 'hold');
  assert.ok(near(plan(-0.15).distance, -0.1));
  assert.equal(plan(-0.3).kind, 'detach');
});

test('sharedWallDrag accepts widen and move_wall; ask comes with questions (item 5)', () => {
  assert.equal(normalizeBuildingPlanEditingPolicy({}).sharedWallDrag, 'widen');
  assert.equal(
    normalizeBuildingPlanEditingPolicy({ sharedWallDrag: 'move_wall' }).sharedWallDrag,
    'move_wall'
  );
  assert.throws(() => normalizeBuildingPlanEditingPolicy({ sharedWallDrag: 'ask' }), TypeError);
});

test('a neighbour wrapping round the dragged corner stays put when the wall widens or detaches', () => {
  // Room 1's north-west wall goes up 2 m: its step faces Room 2's west wall (W8.1) and its north
  // face continues under Room 2 (W3). Dragging Room 2's side of W8.1 away from Room 1 slides
  // Room 2's corner along W3; Room 1 is the partner across W8.1, not a junction to carry along.
  for (const distance of [-0.2, -0.3, -0.6]) {
    const f = createBuildingPlanExample();
    let serial = 0;
    const session = createBuildingPlanSession({
      snapshot: f.snapshot,
      properties: f.meta.properties,
      createId: () => `wrap-${++serial}`,
      derivedCommands: true,
      editingPolicy: { sharedWallDrag: 'widen' },
    });
    const floor = () => session.getSnapshot().floors[0];
    const apply = (operation) => session.apply({ floorId: f.floorId, ...operation });
    const door = floor().walls.find((wall) => wall.doors.length);
    apply({ type: 'remove_opening', wallId: door.id, openingId: door.doors[0].id });
    const northWest = floor().walls.find((wall) => wall.autoLabel === 'W3.2');
    const row = (room, wall) => room.faces.find((face) => face.wallId === wall.id).id;
    apply({ type: 'resize_face', faceId: row(floor().rooms[0], northWest), distance: 2 });
    // Corners only: a new automatic boundary on a straight line is no change of shape.
    const corners = (room) =>
      room.vertices
        .filter((b, i, v) => {
          const [a, c] = [v[(i + v.length - 1) % v.length], v[(i + 1) % v.length]];
          return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) > 1e-9;
        })
        .map((v) => [v.x, v.y]);
    const room1 = corners(floor().rooms[0]);
    const shared = floor().walls.find((wall) => wall.autoLabel === 'W8.1');
    const result = apply({ type: 'resize_face', faceId: row(floor().rooms[1], shared), distance });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    assert.deepEqual(corners(floor().rooms[0]), room1, String(distance));
    assert.deepEqual(session.validate(), []);
  }
});

test("a detached room's step returns against the neighbour's wall, as while widening", () => {
  // Room 2's side of W3 dragged away from Room 1: within the limit the wall widens, past it Room 2
  // detaches. Either way the step left at Room 1's corner stands outside Room 1's east wall
  // (x = 5.2), not level with its corner (manual round, session 4007c4b7).
  for (const distance of [-0.2, -1]) {
    const t = example();
    const door = t.floor().walls.find((wall) => wall.doors.length);
    t.apply({ type: 'remove_opening', wallId: door.id, openingId: door.doors[0].id });
    const room2 = () => t.floor().rooms[1];
    const shared = room2().faces.find(
      (face) => t.floor().walls.find((wall) => wall.id === face.wallId).exposure === 'interior'
    );
    t.apply({ type: 'resize_face', faceId: shared.id, distance });
    const corners = room2()
      .vertices.filter((b, i, v) => {
        const [a, c] = [v[(i + v.length - 1) % v.length], v[(i + 1) % v.length]];
        return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) > 1e-9;
      })
      .map((v) => [Math.round(v.x * 1000) / 1000, Math.round(v.y * 1000) / 1000]);
    const y = Math.round((3.2 - distance) * 1000) / 1000;
    assert.deepEqual(
      corners,
      [
        [3, y],
        [5.2, y],
        [5.2, 3.2],
        [8, 3.2],
        [8, 6.2],
        [3, 6.2],
      ],
      String(distance)
    );
  }
});
