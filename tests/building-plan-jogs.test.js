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
  test(`a jog exposes six straight facing rows and respects physical grouping (${preserveWallGrouping})`, () => {
    const f = fixture({ preserveWallGrouping });
    const plan = coherent(f, f.move(0.2));
    assert.equal(plan.floors[0].rooms[1].faces.length, 6);
    assert.equal(plan.floors[0].walls.length, preserveWallGrouping ? 7 : 9);
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

  test(`straight realignment removes automatic returns and restores four facing rows (${preserveWallGrouping})`, () => {
    const f = fixture({ preserveWallGrouping });
    f.move(-0.2);
    const plan = coherent(f, f.move(0.2));
    assert.equal(plan.floors[0].rooms[1].vertices.length, 4);
    assert.equal(plan.floors[0].rooms[1].faces.length, 4);
    assert.equal(plan.floors[0].walls.length, 7);
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

test('explicit physical separation retains source observations and opening identities', () => {
  const f = fixture({ preserveWallGrouping: true });
  const plan = f.move(0.2);
  const wall = plan.floors[0].walls.find((entry) => entry.segments.length > 1);
  const added = f.session.apply({
    type: 'add_observation',
    floorId: f.floorId,
    subject: { type: 'wall', id: wall.id },
    observedAt: '2026-11-03',
    values: { measured_thickness: 0.19 },
    evidence: ['photo-1'],
  });
  assert.equal(added.status, 'applied');
  const before = f.session.getSnapshot();
  const result = f.session.apply({ type: 'separate_wall', floorId: f.floorId, wallId: wall.id });
  assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  const after = f.session.getSnapshot();
  assert.deepEqual(validateBuildingPlanSnapshot(after), []);
  assert.equal(after.floors[0].walls.length, 9);
  assert.deepEqual(
    after.floors[0].walls.flatMap((entry) => entry.doors),
    before.floors[0].walls.flatMap((entry) => entry.doors)
  );
  const observation = after.floors[0].observations.at(-1);
  assert.deepEqual(observation.subject, before.floors[0].observations.at(-1).subject);
  assert.equal(observation.relatedSubjects.length, 3);
  assert.deepEqual(observation.evidence, ['photo-1']);
  const record = writeBuildingPlanRecord({ meta: f.meta, plan: after, record: f.record });
  assert.deepEqual(
    readBuildingPlanRecord({ meta: f.meta, record }).floors[0].observations,
    after.floors[0].observations
  );
  f.session.undo();
  assert.deepEqual(f.session.getSnapshot(), before);
  f.session.redo();
  assert.deepEqual(f.session.getSnapshot(), after);
});

test('validation rejects a facing edge with no binding and a dangling related observation subject', () => {
  const f = fixture({ preserveWallGrouping: true });
  const plan = f.move(0.2);
  const face = plan.floors[0].rooms[1].faces[0];
  face.edgeIds.push(plan.floors[0].rooms[1].edges[2].id);
  plan.floors[0].observations[0].relatedSubjects = [{ type: 'wall', id: 'missing-wall' }];
  const issues = validateBuildingPlanSnapshot(plan);
  assert.ok(issues.some((issue) => issue.code === 'unbound_facing_edge'));
  assert.ok(issues.some((issue) => issue.code === 'dangling_observation'));
});

test('changing editor policy preserves accepted data and applies only to future operations', () => {
  const f = fixture({ preserveWallGrouping: true });
  const before = f.session.getSnapshot();
  const history = f.session.getState();
  f.session.setEditingPolicy({ preserveWallGrouping: false });
  assert.deepEqual(f.session.getSnapshot(), before);
  assert.deepEqual(f.session.getState(), history);
  assert.equal(f.move(0.2).floors[0].walls.length, 9);
  f.move(-0.2);
  f.session.setEditingPolicy({ preserveWallGrouping: true });
  assert.equal(f.move(0.2).floors[0].walls.length, 7);
});

for (const preserveWallGrouping of [false, true])
  test(`realignment retains distinct construction answers (${preserveWallGrouping})`, () => {
    const f = fixture({ preserveWallGrouping });
    const plan = f.move(0.2);
    const wall = plan.floors[0].walls.find((entry) =>
      entry.segments.some((segment) => segment.junction)
    );
    const segment = wall.segments.find((entry) => entry.junction);
    assert.equal(
      f.session.apply({
        type: 'set_property',
        floorId: f.floorId,
        wallId: wall.id,
        ...(preserveWallGrouping ? { segmentId: segment.id } : {}),
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
      distance: -0.2,
    });
    assert.equal(result.status, 'conflict');
    assert.match(result.issues[0].message, /answers|overrides/i);
    assert.deepEqual(f.session.getSnapshot(), before);
  });
