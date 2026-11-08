import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import {
  createBuildingPlanSession,
  readBuildingPlanRecord,
  writeBuildingPlanRecord,
  buildingPlanCanvasSnapshot,
} from '../src/index.js';
import { buildingPlanFootprints } from '../src/building-plan/footprints.js';
import { cleanPoint, distance, pointInPolygon } from '../src/building-plan/geometry.js';

function fixture(angle = 0, sign = 1) {
  const f = createBuildingPlanExample();
  let serial = 0;
  const createId = () => `junction-profile-${++serial}`;
  const setup = createBuildingPlanSession({
    snapshot: readBuildingPlanRecord({ meta: f.meta, record: f.record }),
    properties: f.meta.properties,
    createId,
  });
  const byLabel = (label) => {
    const plan = setup.getSnapshot();
    const record = writeBuildingPlanRecord({ meta: f.meta, record: f.record, plan });
    return buildingPlanCanvasSnapshot({ meta: f.meta, record, plan }).walls.find(
      (wall) => wall.roomId === plan.floors[0].rooms[0].id && wall.displayLabel === label
    );
  };
  for (const [label, amount] of [
    ['W2', 6.2],
    ['W3.2', 3.2],
  ]) {
    const result = setup.apply({
      type: 'resize_face',
      floorId: f.floorId,
      faceId: byLabel(label).id,
      distance: amount,
    });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  }
  const point = ({ x, y, ...rest }) =>
    cleanPoint({
      ...rest,
      x: sign * x * Math.cos(angle) - y * Math.sin(angle),
      y: sign * x * Math.sin(angle) + y * Math.cos(angle),
    });
  const snapshot = setup.getSnapshot();
  for (const floor of snapshot.floors) {
    for (const room of floor.rooms) {
      room.vertices = room.vertices.map(point);
      for (const edge of room.edges) if (edge.profile) edge.profile.sideSign *= sign;
      for (const face of room.faces) for (const binding of face.bindings) binding.side *= sign;
    }
    for (const wall of floor.walls) {
      for (const side of wall.sides) side.sign *= sign;
      for (const span of wall.segments) {
        span.start = point(span.start);
        span.end = point(span.end);
      }
    }
  }
  const session = createBuildingPlanSession({ snapshot, properties: f.meta.properties, createId });
  const apply = (operation) => {
    const result = session.apply({ floorId: f.floorId, ...operation });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    assert.deepEqual(session.validate(), []);
    return result;
  };
  const roundTrip = () => {
    const snapshot = session.getSnapshot();
    const record = writeBuildingPlanRecord({ meta: f.meta, record: f.record, plan: snapshot });
    const reloaded = readBuildingPlanRecord({ meta: f.meta, record });
    // New ordinary rows hydrate schema fallbacks. Every accepted member must survive.
    const preserved = (expected, actual) => {
      if (expected && typeof expected === 'object') {
        if (Array.isArray(expected)) assert.equal(actual.length, expected.length);
        for (const [key, value] of Object.entries(expected)) preserved(value, actual[key]);
      } else assert.deepEqual(actual, expected);
    };
    preserved(snapshot, reloaded);
    assert.deepEqual(
      readBuildingPlanRecord({
        meta: f.meta,
        record: writeBuildingPlanRecord({ meta: f.meta, record, plan: reloaded }),
      }),
      reloaded
    );
  };
  return { ...f, session, apply, point, roundTrip };
}
function covers(floor, point) {
  return buildingPlanFootprints(floor, 1).wallFootprints.some((wall) =>
    wall.polygons.some((polygon) => pointInPolygon(point, polygon))
  );
}

test('an intentional division across a supplied junction retains its cut and owners', () => {
  const f = fixture(),
    plan = f.session.getSnapshot();
  const record = writeBuildingPlanRecord({ meta: f.meta, record: f.record, plan });
  const selected = buildingPlanCanvasSnapshot({
    meta: f.meta,
    record,
    plan,
    gridSize: 1,
  }).walls.find(
    (wall) =>
      wall.roomId === plan.floors[0].rooms[0].id &&
      wall.points.every((point) => Math.abs(point.y - 3) < 1e-6) &&
      Math.min(...wall.points.map((point) => point.x)) < 8.1 &&
      Math.max(...wall.points.map((point) => point.x)) > 8.1
  );
  f.apply({
    type: 'split_face',
    faceId: selected.id,
    offset: distance(selected.points[0], { x: 8.1, y: 3 }),
  });
  const cut = f.session
    .getSnapshot()
    .floors[0].rooms[0].vertices.find(
      (point) => point.editingCutId && Math.abs(point.x - 8.1) < 1e-6
    );
  assert.ok(cut);
  const roomId = f.apply({
    type: 'create_room',
    rectangle: { x: 8.7, y: 3.6, width: 3, height: 3 },
  }).created.id;
  f.apply({
    type: 'move_room',
    roomId,
    delta: { x: -0.5, y: -0.4 },
    attach: true,
    attachmentTolerance: 0.25,
  });
  const floor = f.session.getSnapshot().floors[0];
  assert.ok(floor.rooms[0].vertices.some((point) => point.editingCutId === cut.editingCutId));
  assert.ok(
    floor.walls.some(
      (wall) =>
        wall.lineage?.explicitPhysicalSeparation &&
        distance(wall.segments[0].start, wall.segments[0].end) < 0.2
    )
  );
  f.roundTrip();
});

test('nested cancellation restores cap geometry and preserves earlier parent answers', () => {
  const f = fixture(),
    s = f.session;
  s.beginScope({ id: 'floor' });
  assert.equal(
    s.apply(
      { type: 'set_values', floorId: f.floorId, values: { floor_note: 'Earlier floor answer' } },
      { scopeId: 'floor' }
    ).status,
    'applied'
  );
  const before = s.getSnapshot(),
    shared = before.floors[0].walls.find((wall) => wall.sides.every((side) => side.roomId));
  s.beginScope({ id: 'room', parentScopeId: 'floor' });
  assert.equal(
    s.apply(
      {
        type: 'set_property',
        floorId: f.floorId,
        wallId: shared.id,
        activeRoomId: before.floors[0].rooms[1].id,
        property: 'wall_thickness_m',
        value: 0.8,
      },
      { scopeId: 'room' }
    ).status,
    'applied'
  );
  assert.ok(covers(s.getSnapshot().floors[0], { x: 2.9, y: 2.7 }));
  assert.equal(s.cancelScope('room').status, 'cancelled');
  assert.deepEqual(s.getSnapshot(), before);
});

for (const angle of [0, 0.37])
  for (const sign of [1, -1]) {
    test(`a three-room attachment has no physical owner across the divider cap (${angle}, ${sign})`, () => {
      const f = fixture(angle, sign);
      const roomId = f.apply({
        type: 'create_room',
        vertices: [
          { x: 8.7, y: 3.6 },
          { x: 11.7, y: 3.6 },
          { x: 11.7, y: 6.6 },
          { x: 8.7, y: 6.6 },
        ].map(f.point),
      }).created.id;
      const before = f.session.getSnapshot();
      f.apply({
        type: 'move_room',
        roomId,
        delta: f.point({ x: -0.5, y: -0.4 }),
        attach: true,
        attachmentTolerance: 0.25,
      });
      const after = f.session.getSnapshot(),
        floor = after.floors[0];
      const centre = f.point({ x: 8.1, y: 3.1 });
      assert.ok(covers(floor, centre), 'The junction must still contain material');
      assert.ok(
        !floor.walls.some((wall) => {
          const span = wall.segments[0];
          return (
            distance(span.start, f.point({ x: 8.2, y: 3.1 })) < 1e-6 &&
            distance(span.end, f.point({ x: 8, y: 3.1 })) < 1e-6
          );
        }),
        'A supplied divider cap must not become an independent physical wall'
      );
      assert.ok(floor.rooms[0].edges.some((edge) => edge.profile));
      assert.deepEqual(
        floor.walls.flatMap((wall) => wall.doors),
        before.floors[0].walls.flatMap((wall) => wall.doors)
      );
      f.roundTrip();
      f.session.undo();
      assert.deepEqual(f.session.getSnapshot(), before);
      f.session.redo();
      assert.deepEqual(f.session.getSnapshot(), after);
      f.apply({ type: 'move_room', roomId, delta: f.point({ x: 0.5, y: 0.4 }), attach: false });
      f.apply({
        type: 'move_room',
        roomId,
        delta: f.point({ x: -0.5, y: -0.4 }),
        attach: true,
        attachmentTolerance: 0.25,
      });
      assert.equal(
        f.session.getSnapshot().floors[0].walls.length,
        floor.walls.length,
        'Reattachment must not revive a profile owner'
      );
      f.roundTrip();
    });

    test(`thickening completes the outer corner and reconciles the clear room (${angle}, ${sign})`, () => {
      const f = fixture(angle, sign),
        before = f.session.getSnapshot();
      const shared = before.floors[0].walls.find((wall) => wall.sides.every((side) => side.roomId));
      f.apply({
        type: 'set_property',
        wallId: shared.id,
        activeRoomId: before.floors[0].rooms[1].id,
        property: 'wall_thickness_m',
        value: 0.8,
      });
      const after = f.session.getSnapshot(),
        floor = after.floors[0];
      const capPoint = f.point({ x: 2.9, y: 2.7 });
      assert.ok(covers(floor, capPoint), 'The two outer faces must meet through material');
      assert.ok(
        !floor.rooms.some((room) => pointInPolygon(capPoint, room.vertices, false)),
        'The cap must not remain recorded as clear room space'
      );
      assert.equal(
        floor.walls.length,
        before.floors[0].walls.length,
        'A corner cap has no new physical owner'
      );
      assert.deepEqual(
        floor.rooms[1].vertices,
        before.floors[0].rooms[1].vertices,
        'The active room face remains fixed'
      );
      f.roundTrip();
      f.session.undo();
      assert.deepEqual(f.session.getSnapshot(), before);
      f.session.redo();
      assert.deepEqual(f.session.getSnapshot(), after);
      for (const value of [0.3, 0.2, 0.8]) {
        f.apply({
          type: 'set_property',
          wallId: shared.id,
          activeRoomId: before.floors[0].rooms[1].id,
          property: 'wall_thickness_m',
          value,
        });
        const current = f.session.getSnapshot().floors[0];
        assert.equal(covers(current, capPoint), value === 0.8);
        assert.equal(
          pointInPolygon(capPoint, current.rooms[0].vertices, false),
          value !== 0.8,
          'Reducing thickness must return the cap area to clear space'
        );
        assert.equal(current.walls.length, before.floors[0].walls.length);
        f.roundTrip();
      }
    });
  }
