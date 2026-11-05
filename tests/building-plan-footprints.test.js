import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import {
  createBuildingPlanSession,
  readBuildingPlanRecord,
  writeBuildingPlanRecord,
  validateBuildingPlanSnapshot,
} from '../src/index.js';
import { buildingPlanCanvasSnapshot } from '../src/building-plan/canvas-controller.js';
import { pointInPolygon } from '../src/building-plan/geometry.js';

function fixture(editingPolicy) {
  const f = createBuildingPlanExample();
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    editingPolicy,
    createId: () => `footprint-${++serial}`,
  });
  const scene = (gridSize = 100) => {
    const plan = session.getSnapshot();
    return buildingPlanCanvasSnapshot({
      meta: f.meta,
      plan,
      gridSize,
      record: writeBuildingPlanRecord({ meta: f.meta, plan, record: f.record }),
    });
  };
  const apply = (operation) => {
    const result = session.apply({ floorId: f.floorId, ...operation });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  };
  return { ...f, session, scene, apply };
}
const covers = (footprints, point) =>
  footprints.some((wall) => wall.polygons.some((p) => pointInPolygon(point, p)));

for (const preserveWallGrouping of [false, true])
  test(`shared corner edits preserve a straight outer wall with no material spike (grouped=${preserveWallGrouping})`, () => {
    const f = fixture({ preserveWallGrouping }),
      floor = f.session.getSnapshot().floors[0];
    f.apply({ type: 'resize_face', faceId: floor.rooms[1].faces[1].id, distance: -3 });
    f.apply({ type: 'resize_face', faceId: f.faceB, distance: 1 });
    const before = f.session.getSnapshot(),
      room = before.floors[0].rooms[1];
    f.apply({
      type: 'move_corner',
      roomId: room.id,
      vertexId: room.vertices[0].id,
      point: { x: 3, y: 1.4 },
    });
    const next = f.session.getSnapshot();
    for (const [i, r] of before.floors[0].rooms.entries())
      for (const vertex of r.vertices.filter((v) => v.x === 5))
        assert.equal(next.floors[0].rooms[i].vertices.find((v) => v.id === vertex.id).x, 5);
    const scene = f.scene(1),
      points = scene.wallFootprints.flatMap((w) => w.polygons.flat());
    assert.ok(
      Math.max(...points.map((p) => p.x)) <= 5.2 + 1e-6,
      'No material beyond the straight 0.20 m outer wall'
    );
    assert.ok(covers(scene.wallFootprints, { x: 5.1, y: 2.7 }));
    assert.ok(!covers(scene.wallFootprints, { x: 5.21, y: 2.1 }));
    assert.deepEqual(validateBuildingPlanSnapshot(next), []);
    f.apply({
      type: 'move_corner',
      roomId: room.id,
      vertexId: room.vertices[0].id,
      point: { x: 3, y: 2.2 },
    });
    assert.deepEqual(
      f.session.getSnapshot().floors[0].rooms.map((r) => r.vertices),
      before.floors[0].rooms.map((r) => r.vertices)
    );
  });

test('one physical shared wall has metric material between its two facing rows and one door cut', () => {
  const f = fixture(),
    before = f.session.getSnapshot(),
    scene = f.scene();
  assert.equal(scene.wallFootprints.length, 7);
  assert.equal(scene.walls.length, 8);
  const shared = scene.wallFootprints.filter((wall) => wall.id === f.wallId);
  assert.equal(shared.length, 1);
  assert.ok(covers(shared, { x: 320, y: 310 }));
  assert.ok(!covers(shared, { x: 320, y: 299 }));
  assert.ok(!covers(shared, { x: 320, y: 321 }));
  assert.equal(scene.physicalOpenings.length, 1);
  assert.equal(scene.doors.length, 2, 'Room-side navigation projections remain available.');
  const door = scene.physicalOpenings[0];
  const mid = { x: (door.points[0].x + door.points[1].x) / 2, y: 310 };
  assert.ok(!covers(shared, mid), 'The canonical opening cuts the full wall band.');
  assert.ok(pointInPolygon(mid, door.polygon));
  assert.deepEqual(f.session.getSnapshot(), before, 'Drawing is read-only.');
});

for (const preserveWallGrouping of [false, true])
  for (const side of ['a', 'b'])
    test(`a new jog return uses the existing opposite wall without doubling its thickness (${side}, grouped=${preserveWallGrouping})`, () => {
      const f = fixture({ preserveWallGrouping });
      const before = f.session.getSnapshot(),
        floor = before.floors[0];
      const active = floor.rooms[side === 'a' ? 0 : 1];
      const neighbour = floor.rooms[side === 'a' ? 1 : 0];
      const existingFace = active.faces[side === 'a' ? 1 : 3];
      const anchorX = side === 'a' ? 5 : 3;
      const expectedX = side === 'a' ? 5.2 : 2.8;
      f.apply({ type: 'resize_face', faceId: side === 'a' ? f.faceA : f.faceB, distance: 0.6 });
      const after = f.session.getSnapshot(),
        next = after.floors[0];
      const linked = next.rooms
        .find((r) => r.id === neighbour.id)
        .faces.find(
          (face) =>
            face.wallId === existingFace.wallId &&
            face.edgeIds.some((id) => {
              const e = next.rooms
                .find((r) => r.id === neighbour.id)
                .edges.find((e) => e.id === id);
              const vs = next.rooms.find((r) => r.id === neighbour.id).vertices;
              return (
                Math.abs(vs.find((v) => v.id === e.startId).x - expectedX) < 1e-6 &&
                Math.abs(vs.find((v) => v.id === e.endId).x - expectedX) < 1e-6
              );
            })
        );
      assert.ok(linked, 'The return must bind to the existing physical subject.');
      const edge = next.rooms
        .find((r) => r.id === neighbour.id)
        .edges.find((e) => e.id === linked.edgeIds[0]);
      const vertices = next.rooms.find((r) => r.id === neighbour.id).vertices;
      assert.equal(vertices.find((v) => v.id === edge.startId).x, expectedX);
      assert.equal(vertices.find((v) => v.id === edge.endId).x, expectedX);
      assert.equal(
        next.rooms.find((r) => r.id === active.id).vertices[side === 'a' ? 1 : 0].x,
        anchorX
      );
      const scene = f.scene();
      const y = side === 'a' ? 340 : 280;
      assert.ok(
        covers(scene.wallFootprints, { x: (anchorX + (side === 'a' ? 0.1 : -0.1)) * 100, y })
      );
      assert.ok(
        !covers(scene.wallFootprints, { x: (anchorX + (side === 'a' ? -0.1 : 0.1)) * 100, y }),
        'No second 0.20 m strip may intrude into the active room.'
      );
      assert.deepEqual(next.observations, floor.observations);
      const record = writeBuildingPlanRecord({ meta: f.meta, plan: after });
      const decoded = readBuildingPlanRecord({ meta: f.meta, record });
      assert.deepEqual(
        decoded.floors[0].walls.map((w) => ({
          id: w.id,
          segments: w.segments,
          overrides: w.overrides,
        })),
        after.floors[0].walls.map((w) => ({
          id: w.id,
          segments: w.segments,
          overrides: w.overrides,
        }))
      );
      assert.deepEqual(decoded.floors[0].observations, after.floors[0].observations);
      assert.deepEqual(
        buildingPlanCanvasSnapshot({ meta: f.meta, plan: decoded, record, gridSize: 100 })
          .wallFootprints,
        f.scene().wallFootprints
      );
      f.session.undo();
      assert.deepEqual(f.session.getSnapshot(), before);
      f.session.redo();
      assert.deepEqual(f.session.getSnapshot(), after);
    });

for (const moving of [0, 1])
  test(`detaching room ${moving + 1} trims the stationary tail and preserves opening positions and source evidence`, () => {
    const f = fixture(),
      before = f.session.getSnapshot(),
      old = before.floors[0].walls.find((w) => w.id === f.wallId);
    const axis = old.segments[0],
      door = old.doors[0];
    const oldDoorX =
      axis.start.x +
      ((axis.end.x - axis.start.x) * door.offset) /
        Math.hypot(axis.end.x - axis.start.x, axis.end.y - axis.start.y);
    f.apply({
      type: 'move_room',
      roomId: before.floors[0].rooms[moving].id,
      delta: { x: 0, y: moving === 0 ? -5 : 5 },
    });
    const after = f.session.getSnapshot(),
      next = after.floors[0].walls.find((w) => w.id === f.wallId);
    assert.equal(next.segments[0].id, axis.id);
    assert.deepEqual(
      [next.segments[0].start.x, next.segments[0].end.x],
      moving === 0 ? [8, 3] : [5, 0]
    );
    assert.equal(next.doors[0].id, door.id);
    const segment = next.segments[0],
      opening = next.doors[0];
    const x =
      segment.start.x +
      ((segment.end.x - segment.start.x) * opening.offset) /
        Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y);
    assert.ok(Math.abs(x - oldDoorX) < 1e-6, 'The door must stay in its original metric position.');
    assert.deepEqual(after.floors[0].observations, before.floors[0].observations);
    const tails = f.scene().wallFootprints.filter((w) => w.id === f.wallId);
    assert.ok(!covers(tails, { x: moving === 0 ? 100 : 600, y: 310 }));
    const record = writeBuildingPlanRecord({ meta: f.meta, plan: after });
    const decoded = readBuildingPlanRecord({ meta: f.meta, record });
    assert.deepEqual(
      decoded.floors[0].walls.map((w) => ({
        id: w.id,
        segments: w.segments,
        overrides: w.overrides,
      })),
      after.floors[0].walls.map((w) => ({ id: w.id, segments: w.segments, overrides: w.overrides }))
    );
    assert.deepEqual(decoded.floors[0].observations, after.floors[0].observations);
    assert.deepEqual(
      buildingPlanCanvasSnapshot({ meta: f.meta, plan: decoded, record, gridSize: 100 })
        .wallFootprints,
      f.scene().wallFootprints
    );
    f.session.undo();
    assert.deepEqual(f.session.getSnapshot(), before);
    f.session.redo();
    assert.deepEqual(f.session.getSnapshot(), after);
  });

test('exterior corners join without filling room interiors, including diagonal walls', () => {
  const f = fixture();
  let scene = f.scene();
  assert.ok(covers(scene.wallFootprints, { x: -10, y: -10 }));
  assert.ok(!covers(scene.wallFootprints, { x: 1, y: 1 }));
  f.apply({
    type: 'create_room',
    vertices: [
      { x: 12, y: 0 },
      { x: 16, y: 0 },
      { x: 14, y: 3 },
    ],
  });
  scene = f.scene();
  for (const wall of scene.wallFootprints)
    for (const polygon of wall.polygons)
      for (const p of polygon) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  assert.ok(!covers(scene.wallFootprints, { x: 1400, y: 100 }));
});

test('repeated jogs have connected material, preserve canonical openings, and undo drawing atomically', () => {
  const f = fixture();
  const before = f.scene();
  f.apply({ type: 'resize_face', faceId: f.faceA, distance: 0.6 });
  let scene = f.scene();
  assert.equal(scene.wallFootprints.length, 8);
  assert.ok(
    covers(scene.wallFootprints, { x: 510, y: 370 }),
    'The jog corner has no material gap.'
  );
  assert.ok(
    !covers(scene.wallFootprints, { x: 530, y: 330 }),
    'The concave room interior stays clear.'
  );
  assert.equal(scene.physicalOpenings.length, 1);
  f.apply({ type: 'resize_face', faceId: f.faceA, distance: -0.8 });
  scene = f.scene();
  assert.equal(scene.physicalOpenings.length, 1);
  assert.equal(f.session.undo().status, 'undone');
  assert.equal(f.session.undo().status, 'undone');
  assert.deepEqual(f.scene(), before);
});

test('segment thickness and active-face anchoring control the drawn width at every grid scale', () => {
  const f = fixture();
  const room = f.session.getSnapshot().floors[0].rooms[0];
  f.apply({
    type: 'set_property',
    wallId: f.wallId,
    activeRoomId: room.id,
    property: 'wall_thickness_m',
    value: 0.3,
  });
  const scene = f.scene();
  const shared = scene.wallFootprints.filter((wall) => wall.id === f.wallId);
  assert.ok(covers(shared, { x: 320, y: 329 }));
  assert.ok(!covers(shared, { x: 320, y: 299 }));
  const small = f.scene(20);
  assert.deepEqual(
    small.wallFootprints.map((w) => w.polygons),
    scene.wallFootprints.map((w) =>
      w.polygons.map((p) =>
        p.map(({ x, y }) => ({
          x: Math.round((x / 5) * 1e8) / 1e8,
          y: Math.round((y / 5) * 1e8) / 1e8,
        }))
      )
    )
  );
  const segmentId = f.session.getSnapshot().floors[0].walls.find((w) => w.id === f.wallId)
    .segments[0].id;
  f.apply({
    type: 'set_property',
    wallId: f.wallId,
    segmentId,
    activeRoomId: room.id,
    property: 'wall_thickness_m',
    value: 0.4,
  });
  assert.ok(
    covers(
      f.scene().wallFootprints.filter((w) => w.id === f.wallId),
      { x: 320, y: 339 }
    )
  );
});

test('explicit unknown thickness stays schematic and never invents a measured wall band', () => {
  const f = fixture();
  f.apply({ type: 'set_property', wallId: f.wallId, property: 'wall_thickness_m', value: null });
  const wall = f.scene().wallFootprints.find((w) => w.id === f.wallId);
  assert.equal(wall.polygons.length, 0);
  assert.equal(wall.schematicSegments.length, 1);
  assert.equal(wall.schematicSegments[0].thicknessUnknown, true);
});

test('jog alignment uses the adjacent construction segment thickness and keeps the active face fixed', () => {
  const f = fixture(),
    wall = f.snapshot.floors[0].walls.find(
      (w) => w.id === f.snapshot.floors[0].rooms[0].faces[1].wallId
    );
  f.apply({
    type: 'set_property',
    wallId: wall.id,
    segmentId: wall.segments[0].id,
    property: 'wall_thickness_m',
    value: 0.3,
  });
  f.apply({ type: 'resize_face', faceId: f.faceA, distance: 0.6 });
  const floor = f.session.getSnapshot().floors[0],
    room = floor.rooms[1];
  assert.ok(room.vertices.some((v) => v.x === 5.3));
  assert.equal(floor.rooms[0].vertices[1].x, 5);
  assert.ok(!covers(f.scene().wallFootprints, { x: 490, y: 340 }));
  assert.deepEqual(f.session.validate(), []);
  f.apply({ type: 'resize_face', faceId: f.faceA, distance: -0.6 });
  assert.equal(f.session.getSnapshot().floors[0].rooms[1].vertices.length, 4);
  assert.deepEqual(f.session.validate(), []);
});

test('a return cannot invent a thickness when the adjacent construction is explicitly unknown', () => {
  const f = fixture(),
    wall = f.snapshot.floors[0].rooms[0].faces[1].wallId;
  f.apply({ type: 'set_property', wallId: wall, property: 'wall_thickness_m', value: null });
  const before = f.session.getSnapshot();
  const result = f.session.apply({
    type: 'resize_face',
    floorId: f.floorId,
    faceId: f.faceA,
    distance: 0.6,
  });
  assert.equal(result.status, 'conflict');
  assert.equal(result.issues[0].code, 'unknown_wall_thickness');
  assert.deepEqual(f.session.getSnapshot(), before);
});

for (const preserveWallGrouping of [false, true])
  test(`new return contacts retain conflicting physical answers until one explicit resolution (${preserveWallGrouping})`, () => {
    const f = fixture({ preserveWallGrouping }),
      right = f.snapshot.floors[0].rooms[0].faces[1].wallId;
    f.apply({ type: 'set_property', wallId: right, property: 'material', value: 'Concrete' });
    f.apply({ type: 'set_property', wallId: f.wallId, property: 'material', value: 'Brick' });
    const before = f.session.getSnapshot(),
      operation = { type: 'resize_face', floorId: f.floorId, faceId: f.faceA, distance: 0.6 };
    const result = f.session.apply(operation);
    assert.equal(result.status, 'conflict');
    assert.equal(result.issues[0].code, 'conflicting_wall_properties');
    assert.deepEqual(f.session.getSnapshot(), before);
    assert.equal(
      f.session.apply({ ...operation, resolutions: { material: 'Concrete' } }).status,
      'applied'
    );
    assert.deepEqual(f.session.getSnapshot().floors[0].observations, before.floors[0].observations);
  });

test('detachment preserves an intentionally authored free-standing wall outside the remaining room', () => {
  const f = fixture();
  f.apply({
    type: 'create_wall',
    roomId: f.snapshot.floors[0].rooms[1].id,
    vertices: [
      { x: 1, y: 4 },
      { x: 6, y: 4 },
    ],
    values: { wall_label: 'Authored partition' },
  });
  const wall = f.session
    .getSnapshot()
    .floors[0].walls.find((w) => w.values.wall_label === 'Authored partition');
  f.apply({ type: 'move_room', roomId: f.snapshot.floors[0].rooms[0].id, delta: { x: 0, y: -5 } });
  assert.deepEqual(
    f.session.getSnapshot().floors[0].walls.find((w) => w.id === wall.id),
    wall
  );
  assert.ok(
    covers(
      f.scene().wallFootprints.filter((w) => w.id === wall.id),
      { x: 150, y: 390 }
    )
  );
});

test('detachment retains the host extent required by an opening outside the remaining facing portion', () => {
  const f = fixture();
  f.apply({ type: 'create_opening', wallId: f.wallId, kind: 'window', offset: 7, width: 0.5 });
  const before = f.session.getSnapshot(),
    window = before.floors[0].walls.find((w) => w.id === f.wallId).windows[0];
  f.apply({ type: 'move_room', roomId: before.floors[0].rooms[0].id, delta: { x: 0, y: -5 } });
  const wall = f.session.getSnapshot().floors[0].walls.find((w) => w.id === f.wallId);
  assert.equal(wall.windows[0].id, window.id);
  assert.equal(wall.segments[0].end.x, 0.5);
  assert.equal(wall.windows[0].offset, 7);
  assert.deepEqual(f.session.validate(), []);
});

for (const moving of [0, 1])
  test(`grouped detachment reconciles every captured segment and a later room move translates it once (${moving})`, () => {
    const f = fixture({ preserveWallGrouping: true });
    f.apply({ type: 'resize_face', faceId: f.faceA, distance: 0.6 });
    f.apply({
      type: 'move_room',
      roomId: f.snapshot.floors[0].rooms[moving].id,
      delta: { x: 0, y: moving === 0 ? -5 : 5 },
    });
    assert.deepEqual(f.session.validate(), []);
    const stationary = f.session.getSnapshot().floors[0].rooms[1 - moving];
    f.apply({ type: 'move_room', roomId: stationary.id, delta: { x: 10, y: 0 } });
    assert.deepEqual(
      f.session.getSnapshot().floors[0].rooms[1 - moving].vertices,
      stationary.vertices.map((v) => ({ ...v, x: v.x + 10 }))
    );
    assert.deepEqual(f.session.validate(), []);
    const p = f.session.getSnapshot(),
      record = writeBuildingPlanRecord({ meta: f.meta, plan: p });
    assert.deepEqual(
      validateBuildingPlanSnapshot(readBuildingPlanRecord({ meta: f.meta, record })),
      []
    );
  });

test('retired automatic segment observations retain their original measured context', () => {
  const f = fixture({ preserveWallGrouping: true });
  f.apply({ type: 'resize_face', faceId: f.faceA, distance: 0.6 });
  const floor = f.session.getSnapshot().floors[0];
  const wall = floor.walls.find((wall) =>
    wall.segments.some((segment) =>
      [segment.start, segment.end].every((p) => Math.abs(p.y - 3.1) < 1e-6)
    )
  );
  const segment = wall.segments.find((segment) =>
    [segment.start, segment.end].every((p) => Math.abs(p.y - 3.1) < 1e-6)
  );
  f.apply({
    type: 'add_observation',
    subject: { type: 'segment', id: segment.id },
    observedAt: '2026-11-04T10:00:00Z',
    coverage: { interval: [0, 1] },
    evidence: [{ reference: 'fixture://original-segment' }],
    values: { observed_thickness_m: 0.19 },
  });
  const original = f.session.getSnapshot().floors[0].observations.at(-1);
  f.apply({ type: 'move_room', roomId: floor.rooms[1].id, delta: { x: 0, y: 5 } });
  const after = f.session.getSnapshot().floors[0];
  assert.ok(!after.walls.flatMap((wall) => wall.segments).some((s) => s.id === segment.id));
  assert.deepEqual(after.observations.at(-1), {
    ...original,
    subject: { type: 'wall', id: wall.id },
  });
  assert.deepEqual(f.session.validate(), []);
});

test('detachment preserves meaningful collinear segment divisions and their overrides', () => {
  const f = fixture();
  const original = f.snapshot.floors[0].walls.find((w) => w.id === f.wallId);
  f.apply({ type: 'split_wall', wallId: f.wallId, offset: 2 });
  const other = f.session
    .getSnapshot()
    .floors[0].walls.find((w) => w.id !== f.wallId && w.lineage?.splitFromWallId === f.wallId);
  assert.ok(other);
  f.apply({
    type: 'set_property',
    wallId: f.wallId,
    segmentId: original.segments[0].id,
    property: 'wall_height_m',
    value: 2.6,
  });
  f.apply({ type: 'join_walls', wallId: f.wallId, otherWallId: other.id });
  f.apply({ type: 'move_room', roomId: f.snapshot.floors[0].rooms[0].id, delta: { x: 0, y: -5 } });
  const wall = f.session.getSnapshot().floors[0].walls.find((w) => w.id === f.wallId);
  assert.equal(wall.segments.length, 2);
  assert.equal(wall.segments[0].overrides.wall_height_m, 2.6);
  assert.deepEqual(
    wall.segments.map((s) => [s.start.x, s.end.x]),
    [
      [8, 6],
      [6, 3],
    ]
  );
  assert.deepEqual(f.session.validate(), []);
});

test('child cancellation restores the shared return and detached extents while keeping earlier floor defaults', () => {
  const f = fixture();
  f.session.beginScope({ id: 'floor' });
  assert.equal(
    f.session.apply(
      { type: 'set_defaults', floorId: f.floorId, property: 'wall_height_m', value: 3.4 },
      { scopeId: 'floor' }
    ).status,
    'applied'
  );
  const before = f.session.getSnapshot(),
    roomId = before.floors[0].rooms[0].id;
  f.session.beginScope({
    id: 'room',
    parentScopeId: 'floor',
    subject: { type: 'room', id: roomId },
  });
  for (const operation of [
    { type: 'resize_face', faceId: f.faceA, distance: 0.6 },
    { type: 'move_room', roomId, delta: { x: 0, y: -5 } },
  ])
    assert.equal(
      f.session.apply({ floorId: f.floorId, ...operation }, { scopeId: 'room' }).status,
      'applied'
    );
  assert.equal(f.session.cancelScope('room').status, 'cancelled');
  assert.deepEqual(f.session.getSnapshot(), before);
});

test('thickness-spaced return alignment confirms a partially cut opening and removes it in the same operation', () => {
  const f = fixture();
  f.apply({ type: 'create_opening', wallId: f.wallId, kind: 'window', offset: 2.5, width: 0.4 });
  const before = f.session.getSnapshot(),
    opening = before.floors[0].walls.find((w) => w.id === f.wallId).windows[0];
  const operation = { type: 'resize_face', floorId: f.floorId, faceId: f.faceA, distance: 0.6 };
  const result = f.session.apply(operation);
  assert.equal(result.status, 'conflict');
  assert.equal(result.issues[0].code, 'opening_cut_requires_confirmation');
  assert.deepEqual(result.issues[0].openingIds, [opening.id]);
  assert.deepEqual(f.session.getSnapshot(), before);
  assert.equal(f.session.apply({ ...operation, removeOpeningIds: [opening.id] }).status, 'applied');
  assert.equal(f.session.getSnapshot().floors[0].walls.flatMap((w) => w.windows).length, 0);
  assert.equal(f.session.getSnapshot().floors[0].walls.flatMap((w) => w.doors).length, 1);
  f.session.undo();
  assert.deepEqual(f.session.getSnapshot(), before);
});
