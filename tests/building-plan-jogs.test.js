import { originalFaces } from './helpers/building-plan-v2.js';
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

function fixture(editingPolicy) {
  const f = createBuildingPlanExample();
  let id = 0;
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    editingPolicy,
    createId: () => `jog-${++id}`,
  });
  const move = (distance) => {
    const result = session.apply({
      type: 'resize_face',
      floorId: f.floorId,
      faceId: f.faceA,
      distance,
    });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    return session.getSnapshot();
  };
  return { ...f, session, move };
}

function coherent(f, plan) {
  assert.deepEqual(validateBuildingPlanSnapshot(plan), []);
  const record = writeBuildingPlanRecord({ meta: f.meta, plan, record: f.record });
  const decoded = readBuildingPlanRecord({ meta: f.meta, record });
  const scene = buildingPlanCanvasSnapshot({ meta: f.meta, record, plan: decoded });
  for (const room of decoded.floors[0].rooms)
    for (const face of room.faces)
      for (const edgeId of face.edgeIds || [])
        assert.ok(
          face.bindings.some((binding) => binding.edgeId === edgeId),
          'A declared facing edge must have its physical binding.'
        );
  for (const wall of scene.walls)
    for (let i = 1; i < wall.points.length; i++)
      assert.ok(
        Math.abs(wall.points[i].x - wall.points[i - 1].x) < 1e-6 ||
          Math.abs(wall.points[i].y - wall.points[i - 1].y) < 1e-6,
        'Orthogonal edits must not produce diagonal scene bridges.'
      );
  assert.equal(decoded.floors[0].walls.flatMap((wall) => wall.doors).length, 1);
  assert.equal(decoded.floors[0].walls.flatMap((wall) => wall.doors)[0].width, 0.9);
  assert.deepEqual(decoded.floors[0].observations, f.snapshot.floors[0].observations);
  return decoded;
}

for (const preserveWallGrouping of [false, true]) {
  test(`a jog exposes one straight span per physical owner (${preserveWallGrouping})`, () => {
    const f = fixture({ preserveWallGrouping });
    const plan = coherent(f, f.move(0.2));
    assert.equal(plan.floors[0].rooms[1].faces.length, 6);
    assert.equal(plan.floors[0].walls.length, 11);
    assert.ok(plan.floors[0].rooms.some((room) => room.edges.some((edge) => edge.profile)));
    assert.ok(plan.floors[0].walls.every((wall) => wall.segments.length === 1));
    const shared = plan.floors[0].rooms.map((room) =>
      room.faces.find(
        (face) => face.id === (room.id === f.snapshot.floors[0].rooms[0].id ? f.faceA : f.faceB)
      )
    );
    assert.equal(shared[0].wallId, shared[1].wallId);
  });

  test(`repeated jogs across the original alignment retain coherent wall paths (${preserveWallGrouping})`, () => {
    const f = fixture({ preserveWallGrouping });
    f.move(0.2);
    const plan = coherent(f, f.move(-0.4));
    assert.equal(plan.floors[0].rooms[1].faces.length, 6);
    const final = f.session.getSnapshot();
    assert.equal(f.session.undo().status, 'undone');
    assert.equal(f.session.redo().status, 'redone');
    assert.deepEqual(f.session.getSnapshot(), final);
  });

  test(`straight realignment removes automatic returns and retains adjacency boundaries (${preserveWallGrouping})`, () => {
    const f = fixture({ preserveWallGrouping });
    f.move(-0.2);
    const plan = coherent(f, f.move(0.2));
    assert.equal(plan.floors[0].rooms[1].vertices.length, 5);
    assert.equal(plan.floors[0].rooms[1].faces.length, 5);
    assert.equal(plan.floors[0].walls.length, 9);
  });
}

test('rejected shared-face collapse remains atomic and explains how to recover', () => {
  const f = fixture();
  const before = f.session.getSnapshot();
  const result = f.session.apply({
    type: 'resize_face',
    floorId: f.floorId,
    faceId: f.faceA,
    distance: 3.2,
  });
  assert.equal(result.status, 'conflict');
  assert.deepEqual(f.session.getSnapshot(), before);
  assert.match(result.issues[0].message, /room|wall/i);
  assert.match(result.issues[0].message, /shorter|smaller|back|cancel/i);
});

test('jog ownership and canonical opening identities survive record round trips and Undo', () => {
  const f = fixture();
  const before = f.session.getSnapshot();
  const after = f.move(0.2);
  coherent(f, after);
  assert.ok(after.floors[0].walls.every((wall) => wall.segments.length === 1));
  assert.deepEqual(
    after.floors[0].walls
      .flatMap((wall) => wall.doors)
      .map(({ id, width, height }) => ({ id, width, height })),
    before.floors[0].walls
      .flatMap((wall) => wall.doors)
      .map(({ id, width, height }) => ({ id, width, height }))
  );
  f.session.undo();
  assert.deepEqual(f.session.getSnapshot(), before);
  f.session.redo();
  assert.deepEqual(f.session.getSnapshot(), after);
});

test('validation rejects a facing edge with no physical binding', () => {
  const f = fixture({ preserveWallGrouping: true });
  const plan = f.move(0.2);
  const face = originalFaces(plan.floors[0].rooms[1])[0];
  face.edgeIds.push(plan.floors[0].rooms[1].edges[2].id);
  const issues = validateBuildingPlanSnapshot(plan);
  assert.ok(issues.some((issue) => issue.code === 'unbound_facing_edge'));
});

test('changing editor policy preserves accepted data and applies only to future operations', () => {
  const f = fixture({ preserveWallGrouping: true });
  const before = f.session.getSnapshot();
  const history = f.session.getState();
  f.session.setEditingPolicy({ inheritedChangePolicy: 'apply' });
  assert.deepEqual(f.session.getSnapshot(), before);
  assert.deepEqual(f.session.getState(), history);
  assert.equal(f.move(0.2).floors[0].walls.length, 11);
  f.move(-0.2);
  f.session.setEditingPolicy({ inheritedChangePolicy: 'ask' });
  assert.equal(f.move(0.2).floors[0].walls.length, 11);
});

for (const preserveWallGrouping of [false, true])
  test(`realignment retains distinct construction answers (${preserveWallGrouping})`, () => {
    const f = fixture({ preserveWallGrouping });
    const plan = f.move(0.6);
    const wall = plan.floors[0].walls.find((entry) =>
      entry.segments.some((segment) => segment.junction)
    );
    assert.equal(
      f.session.apply({
        type: 'set_property',
        floorId: f.floorId,
        wallId: wall.id,
        property: 'wall_height_m',
        value: 2.6,
      }).status,
      'applied'
    );
    const before = f.session.getSnapshot();
    const result = f.session.apply({
      type: 'resize_face',
      floorId: f.floorId,
      faceId: f.faceA,
      distance: -0.6,
    });
    assert.equal(result.status, 'conflict');
    assert.match(result.issues[0].message, /answers|overrides|smaller/i);
    assert.deepEqual(f.session.getSnapshot(), before);
  });
