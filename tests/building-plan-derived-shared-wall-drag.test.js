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
      property: 'wall_thickness_m',
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
  assert.equal(wall.properties.wall_thickness_m, 0.4);
  assert.equal(wall.overrides.wall_thickness_m, 0.4, 'the widened width is explicit');
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
  // Exterior 0.5: both rooms' own walls need 1 m, so between 0.5 and 1 m the face holds.
  const held = example(0.5);
  held.apply({ type: 'resize_face', faceId: held.f.faceA, distance: -0.5 });
  const a = held.floor().rooms[0];
  assert.ok(near(top(a), 2.7), 'held at the 0.5 m limit');
  assert.equal(wallOf(held.floor(), a, 2.7).properties.wall_thickness_m, 0.5);

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
  specifications.wall_thickness_m = {
    ...specifications.wall_thickness_m,
    field: { ...specifications.wall_thickness_m.field, max: 0.3 },
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
