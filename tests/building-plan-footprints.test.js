import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import { createBuildingPlanSession, writeBuildingPlanRecord } from '../src/index.js';
import { buildingPlanCanvasSnapshot } from '../src/building-plan/canvas-controller.js';
import { pointInPolygon } from '../src/building-plan/geometry.js';

function fixture() {
  const f = createBuildingPlanExample();
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
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
  assert.equal(scene.wallFootprints.length, 9);
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
