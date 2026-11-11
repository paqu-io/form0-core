import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBuildingPlanSession,
  readBuildingPlanRecord,
  writeBuildingPlanRecord,
} from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import { extractBuildingPlanPrimary } from '../src/building-plan/derive/index.js';
import {
  assertRoundTrip,
  canonicalFloor,
  derivedSpecifications,
  rotate,
  writeBack,
} from './helpers/building-plan-derive.js';

function fixture(snapshot = createBuildingPlanExample().snapshot) {
  const example = createBuildingPlanExample();
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot,
    properties: example.meta.properties,
    createId: () => `round-${++serial}`,
  });
  const apply = (operation) => {
    const result = session.apply({ floorId: example.floorId, ...operation });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  };
  const floor = () => session.getSnapshot().floors[0];
  return { ...example, apply, floor, specifications: derivedSpecifications(example.meta) };
}

test('an unchanged floor writes back to itself: walls, sides, rows, bindings and the door', () => {
  const f = fixture();
  const result = assertRoundTrip(f.floor(), f.specifications);
  assert.equal(result.floor.walls.length, f.floor().walls.length);
});

test('the round trip holds for different thicknesses and rotated plans', () => {
  const thick = fixture();
  thick.apply({
    type: 'set_provider',
    nodeKey: 'floors',
    fieldName: 'floor_exterior_wall_thickness',
    property: 'wall_thickness_m',
    value: 0.5,
  });
  assertRoundTrip(thick.floor(), thick.specifications);
  const turned = fixture(rotate(createBuildingPlanExample().snapshot, 0.37));
  assertRoundTrip(turned.floor(), turned.specifications);
});

test('the round trip holds with an explicit Split, a partition and an unknown thickness', () => {
  const f = fixture();
  const exterior = f.floor().walls.find((wall) => wall.autoLabel === 'W1');
  const face = f.floor().rooms[0].faces.find((entry) => entry.wallId === exterior.id);
  f.apply({ type: 'split_face', faceId: face.id, offset: 2 });
  f.apply({
    type: 'create_wall',
    roomId: f.floor().rooms[0].id,
    vertices: [
      { x: 1, y: 1 },
      { x: 4, y: 1 },
    ],
  });
  const shared = f.floor().walls.find((wall) => wall.exposure === 'interior' && wall.doors.length);
  f.apply({ type: 'set_property', wallId: shared.id, property: 'wall_thickness_m', value: null });
  assertRoundTrip(f.floor(), f.specifications);
});

test('walls are written in canonical orientation: the reference row lies on side +1', () => {
  const f = fixture();
  const floor = f.floor();
  const { floor: written } = writeBack(floor, f.specifications);
  for (const wall of written.walls) {
    const reference = written.rooms
      .flatMap((room) => room.faces)
      .find((face) => face.id === wall.referenceFaceId);
    assert.equal(reference.bindings[0].side, 1, `${wall.autoLabel} reference side`);
    assert.equal(wall.sides.find((side) => side.id === reference.sideId).sign, 1);
  }
  // Reversing a wall keeps its side identities on the same rooms and its door in place.
  const canonical = canonicalFloor(floor);
  for (const wall of floor.walls) {
    const other = canonical.walls.find((entry) => entry.id === wall.id);
    for (const side of wall.sides)
      assert.equal(other.sides.find((entry) => entry.id === side.id).roomId, side.roomId);
  }
});

test('primary data anchors openings to a row and carries no stored geometry', () => {
  const f = fixture();
  const primary = extractBuildingPlanPrimary(f.floor());
  const shared = [...primary.subjects.values()].find((subject) => subject.openings.length);
  assert.equal(shared.segments, undefined);
  assert.equal(shared.openings[0].offset, undefined);
  assert.ok(primary.anchors.some((anchor) => anchor.faceId === shared.openings[0].faceId));
  assert.ok(
    primary.rooms.every((room) => !room.faces && room.edges.every((edge) => !edge.profile))
  );
});

test('the written floor goes through the record without turning labels into typed answers', () => {
  const f = fixture();
  const { floor } = writeBack(f.floor(), f.specifications);
  const plan = { ...f.snapshot, floors: [floor] };
  const record = writeBuildingPlanRecord({ meta: f.meta, plan, record: f.record });
  const decoded = readBuildingPlanRecord({ meta: f.meta, record });
  for (const wall of decoded.floors[0].walls) {
    assert.match(wall.autoLabel, /^W\d+(\.\d+)*$/);
    assert.equal(wall.values.wall_label, undefined, `${wall.autoLabel} has no typed label`);
  }
  assertRoundTrip(decoded.floors[0], f.specifications);
});
