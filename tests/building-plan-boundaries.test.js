import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import {
  createBuildingPlanSession,
  readBuildingPlanRecord,
  writeBuildingPlanRecord,
  validateBuildingPlanSnapshot,
  BuildingPlanCanvasController,
} from '../src/index.js';
const fixture = () => {
  const f = createBuildingPlanExample();
  let id = 0;
  return {
    ...f,
    session: createBuildingPlanSession({
      snapshot: readBuildingPlanRecord({ meta: f.meta, record: f.record }),
      properties: f.meta.properties,
      createId: () => `boundary-${++id}`,
    }),
  };
};
const edit = (f, faceId, distance, extra = {}) =>
  f.session.apply({ type: 'resize_face', floorId: f.floorId, faceId, distance, ...extra });
function coverage(plan) {
  for (const room of plan.floors[0].rooms)
    for (let i = 0; i < room.edges.length; i++) {
      const edge = room.edges[i];
      const intervals = room.faces
        .flatMap((f) => f.bindings.filter((b) => b.edgeId === edge.id).map((b) => b.roomInterval))
        .sort((a, b) => a[0] - b[0]);
      let end = 0;
      for (const [a, b] of intervals) {
        assert.ok(a <= end + 1e-6, 'No gap in a captured boundary');
        end = Math.max(end, b);
      }
      const a = room.vertices[i],
        b = room.vertices[(i + 1) % room.vertices.length];
      assert.ok(
        Math.abs(end - Math.hypot(b.x - a.x, b.y - a.y)) < 1e-6,
        'Physical walls must reach the captured corner'
      );
    }
}
test('extending a shared boundary retains full wall coverage, opening position and source observations', () => {
  const f = fixture(),
    before = f.session.getSnapshot();
  assert.equal(edit(f, before.floors[0].rooms[1].faces[3].id, 3.2).status, 'applied');
  const after = f.session.getSnapshot();
  coverage(after);
  assert.deepEqual(validateBuildingPlanSnapshot(after), []);
  assert.deepEqual(after.floors[0].observations, before.floors[0].observations);
  assert.deepEqual(
    after.floors[0].walls.flatMap((w) => w.doors),
    before.floors[0].walls.flatMap((w) => w.doors)
  );
  f.session.undo();
  assert.deepEqual(f.session.getSnapshot(), before);
  f.session.redo();
  assert.deepEqual(f.session.getSnapshot(), after);
});
test('the supplied W3/W2 contact sequence establishes sharing and avoids the narrow dent', () => {
  const f = fixture(),
    right = f.snapshot.floors[0].rooms[0].faces[1].id;
  for (const [face, distance] of [
    [f.faceA, 0.6],
    [right, -0.4],
    [right, 0.2],
  ])
    assert.equal(edit(f, face, distance).status, 'applied');
  const aligned = f.session.getSnapshot().floors[0];
  const a = aligned.rooms[0].faces.find((face) => face.id === right);
  const b =
    aligned.rooms[1].faces.find(
      (face) => aligned.walls.find((w) => w.id === face.wallId).values.wall_label === 'W3.3'
    ) || aligned.rooms[1].faces.find((face) => face.wallId === a.wallId);
  assert.equal(a.wallId, b.wallId, 'A completed compatible contact must be shared');
  assert.equal(edit(f, f.faceA, -0.8).status, 'applied');
  const after = f.session.getSnapshot();
  assert.equal(after.floors[0].rooms[1].vertices.length, 6);
  coverage(after);
  assert.deepEqual(validateBuildingPlanSnapshot(after), []);
  const record = writeBuildingPlanRecord({ meta: f.meta, plan: after, record: f.record });
  assert.deepEqual(
    readBuildingPlanRecord({ meta: f.meta, record }).floors[0].rooms,
    after.floors[0].rooms
  );
  f.session.undo();
  f.session.redo();
  assert.deepEqual(f.session.getSnapshot(), after);
});
for (const kind of ['door', 'window'])
  test(`partial ${kind} cuts require a precise confirmation and remove atomically`, () => {
    const f = fixture();
    if (kind === 'window') {
      const p = f.session.getSnapshot();
      const wall = p.floors[0].walls.find((w) => w.doors.length);
      wall.windows = wall.doors.map((d) => ({ ...d, type: 'window' }));
      wall.doors = [];
      f.session = createBuildingPlanSession({ snapshot: p, properties: f.meta.properties });
    }
    const before = f.session.getSnapshot(),
      left = before.floors[0].rooms[1].faces[3].id;
    const r = edit(f, left, -1);
    assert.equal(r.status, 'conflict');
    assert.equal(r.issues[0].code, 'opening_cut_requires_confirmation');
    const ids = r.issues[0].openingIds;
    assert.equal(ids.length, 1);
    assert.deepEqual(f.session.getSnapshot(), before);
    assert.equal(edit(f, left, -1, { removeOpeningIds: ['unrelated'] }).status, 'conflict');
    assert.equal(edit(f, left, -1, { removeOpeningIds: ids }).status, 'applied');
    const after = f.session.getSnapshot();
    assert.equal(after.floors[0].walls.flatMap((w) => [...w.doors, ...w.windows]).length, 0);
    assert.equal(after.floors[0].rooms[1].vertices[0].x, 4);
    f.session.undo();
    assert.deepEqual(f.session.getSnapshot(), before);
    f.session.redo();
    assert.deepEqual(f.session.getSnapshot(), after);
  });
test('an opening wholly outside the edited room remains on the stationary physical wall', () => {
  const f = fixture(),
    before = f.session.getSnapshot();
  assert.equal(edit(f, before.floors[0].rooms[1].faces[3].id, -1.8).status, 'applied');
  assert.deepEqual(
    f.session.getSnapshot().floors[0].walls.flatMap((w) => w.doors),
    before.floors[0].walls.flatMap((w) => w.doors)
  );
});
test('same-line room snapping resolves both axes without merging physical subjects', () => {
  const f = fixture();
  const c = new BuildingPlanCanvasController({
    meta: f.meta,
    readRecord: () => f.record,
    writeRecord: () => false,
  });
  const room = c.getSnapshot().rooms[1];
  const points = room.vertices.map((p) => ({ ...p, x: p.x - 2.88 * 20 }));
  const snap = c.interaction.snapTranslation(points, {
    roomId: room.id,
    originalPoints: room.vertices,
  });
  assert.equal(snap[0].x, 0);
  assert.equal(snap[0].y, 64);
  assert.equal(c.getSnapshot().walls.length, 8);
  c.dispose();
});

for (const confirmed of [false, true])
  test(`canvas opening confirmation ${confirmed ? 'accepts one operation' : 'preserves the layout on cancel'}`, async () => {
    const f = fixture();
    let record = structuredClone(f.record),
      writes = 0,
      prompts = 0;
    const c = new BuildingPlanCanvasController({
      meta: f.meta,
      readRecord: () => record,
      writeRecord: (next) => {
        writes++;
        record = next;
      },
      confirmOpeningRemoval: (issue) => {
        prompts++;
        assert.equal(issue.openingIds.length, 1);
        return confirmed;
      },
    });
    const face = f.snapshot.floors[0].rooms[1].faces[3].id;
    const points = c
      .getSnapshot()
      .walls.find((w) => w.id === face)
      .points.map((p) => ({ ...p, x: 80 }));
    await c.updateWall(face, points);
    assert.equal(prompts, 1);
    assert.equal(writes, confirmed ? 1 : 0);
    const plan = readBuildingPlanRecord({ meta: f.meta, record });
    assert.equal(plan.floors[0].walls.flatMap((w) => w.doors).length, confirmed ? 0 : 1);
    c.dispose();
  });
test('a stale opening confirmation cannot accept into a disposed or changed host', async () => {
  const f = fixture();
  let release,
    record = structuredClone(f.record),
    writes = 0;
  const c = new BuildingPlanCanvasController({
    meta: f.meta,
    readRecord: () => record,
    writeRecord: () => {
      writes++;
    },
    confirmOpeningRemoval: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const face = f.snapshot.floors[0].rooms[1].faces[3].id;
  const pending = c.updateWall(
    face,
    c
      .getSnapshot()
      .walls.find((w) => w.id === face)
      .points.map((p) => ({ ...p, x: 80 }))
  );
  assert.equal(c.isBusy(), true);
  c.dispose();
  release(true);
  await pending;
  assert.equal(writes, 0);
});
test('opening observations require the explicit cascade and are restored by the same Undo', () => {
  const f = fixture();
  const door = f.session.getSnapshot().floors[0].walls.flatMap((w) => w.doors)[0];
  assert.equal(
    f.session.apply({
      type: 'add_observation',
      floorId: f.floorId,
      subject: { type: 'door', id: door.id },
      observedAt: '2026-11-03',
      evidence: ['opening-photo'],
    }).status,
    'applied'
  );
  const before = f.session.getSnapshot(),
    left = before.floors[0].rooms[1].faces[3].id;
  const result = edit(f, left, -1);
  assert.equal(result.issues[0].observationIds.length, 1);
  assert.equal(edit(f, left, -1, { removeOpeningIds: [door.id] }).status, 'conflict');
  assert.equal(
    edit(f, left, -1, { removeOpeningIds: [door.id], allowObservationDeletion: true }).status,
    'applied'
  );
  f.session.undo();
  assert.deepEqual(f.session.getSnapshot(), before);
});

for (const up of [-0.2, -0.6, -0.8])
  test(`a connected corner handles partial, straight, and reversed return movement (${up})`, () => {
    const f = fixture(),
      right = f.snapshot.floors[0].rooms[0].faces[1].id;
    for (const [face, distance] of [
      [f.faceA, 0.6],
      [right, -0.4],
      [right, 0.2],
      [f.faceA, up],
    ]) {
      const result = edit(f, face, distance);
      assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    }
    coverage(f.session.getSnapshot());
    assert.deepEqual(validateBuildingPlanSnapshot(f.session.getSnapshot()), []);
    assert.equal(f.session.getSnapshot().floors[0].walls.flatMap((w) => w.doors).length, 1);
  });

test('new contact conflicts preserve both physical answers until an explicit common resolution', () => {
  const f = fixture(),
    right = f.snapshot.floors[0].rooms[0].faces[1].id;
  edit(f, f.faceA, 0.6);
  const floor = f.session.getSnapshot().floors[0];
  const a = floor.rooms[0].faces.find((face) => face.id === right).wallId;
  const b = floor.walls.find((w) => w.values.wall_label === 'W3.3').id;
  for (const [wallId, value] of [
    [a, 'Concrete'],
    [b, 'Brick'],
  ])
    assert.equal(
      f.session.apply({
        type: 'set_property',
        floorId: f.floorId,
        wallId,
        property: 'material',
        value,
      }).status,
      'applied'
    );
  assert.equal(edit(f, right, -0.4).status, 'applied');
  const before = f.session.getSnapshot();
  assert.equal(edit(f, right, 0.2).status, 'conflict');
  assert.deepEqual(f.session.getSnapshot(), before);
  assert.equal(edit(f, right, 0.2, { resolutions: { material: 'Concrete' } }).status, 'applied');
});

test('confirmation cannot overwrite an answer changed while the prompt was open', async () => {
  const f = fixture();
  let record = structuredClone(f.record),
    release,
    writes = 0;
  const c = new BuildingPlanCanvasController({
    meta: f.meta,
    readRecord: () => record,
    writeRecord: () => {
      writes++;
    },
    confirmOpeningRemoval: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const face = f.snapshot.floors[0].rooms[1].faces[3].id;
  const pending = c.updateWall(
    face,
    c
      .getSnapshot()
      .walls.find((w) => w.id === face)
      .points.map((p) => ({ ...p, x: 80 }))
  );
  record.values.unrelated_typed_answer = 'new answer';
  release(true);
  await pending;
  assert.equal(writes, 0);
  assert.equal(record.values.unrelated_typed_answer, 'new answer');
  c.dispose();
});
test('one precise confirmation can remove both affected openings and restore them together', () => {
  const f = fixture();
  const floor = f.session.getSnapshot().floors[0],
    wall = floor.walls.find((w) => w.doors.length);
  assert.equal(
    f.session.apply({
      type: 'create_opening',
      floorId: f.floorId,
      wallId: wall.id,
      kind: 'window',
      offset: 3.5,
      width: 0.9,
      height: 0.5,
      sillHeight: 2.3,
    }).status,
    'applied'
  );
  const before = f.session.getSnapshot(),
    left = before.floors[0].rooms[1].faces[3].id;
  const result = edit(f, left, -1);
  assert.equal(result.issues[0].openingIds.length, 2);
  assert.equal(
    edit(f, left, -1, { removeOpeningIds: result.issues[0].openingIds }).status,
    'applied'
  );
  assert.equal(
    f.session.getSnapshot().floors[0].walls.flatMap((w) => [...w.doors, ...w.windows]).length,
    0
  );
  f.session.undo();
  assert.deepEqual(f.session.getSnapshot(), before);
});

test('invalid opening resizing keeps ordinary width validation without suggesting its deletion', () => {
  const f = fixture(),
    floor = f.session.getSnapshot().floors[0],
    wall = floor.walls.find((w) => w.doors.length),
    before = f.session.getSnapshot();
  const result = f.session.apply({
    type: 'update_opening',
    floorId: f.floorId,
    wallId: wall.id,
    openingId: wall.doors[0].id,
    width: 20,
  });
  assert.equal(result.status, 'conflict');
  assert.equal(result.issues[0].code, 'opening_outside_wall');
  assert.deepEqual(f.session.getSnapshot(), before);
});

test('an unrelated floor edit cannot offer removal for a pre-existing partial opening elsewhere', async () => {
  const f = fixture(),
    snapshot = f.session.getSnapshot();
  const { applyBuildingPlanOperation } = await import('../src/building-plan/operations.js');
  const { BUILDING_PLAN_PROPERTIES } = await import('../src/building-plan/model.js');
  let serial = 0;
  applyBuildingPlanOperation(
    snapshot,
    {
      type: 'resize_face',
      floorId: f.floorId,
      faceId: snapshot.floors[0].rooms[1].faces[3].id,
      distance: -1,
    },
    {
      createId: () => `legacy-${++serial}`,
      specifications: { ...BUILDING_PLAN_PROPERTIES, ...f.meta.properties },
    }
  );
  const session = createBuildingPlanSession({ snapshot, properties: f.meta.properties });
  const before = session.getSnapshot();
  assert.equal(session.apply({ type: 'create_floor' }).status, 'applied');
  assert.deepEqual(session.getSnapshot().floors[0], before.floors[0]);
});

test('child cancellation restores confirmed geometry/removal while keeping an earlier floor default', async () => {
  const f = fixture();
  const { createBuildingPlanEditor } = await import('../src/index.js');
  const editor = createBuildingPlanEditor({ meta: f.meta, record: f.record });
  const n = f.meta.repeatablesByNodeKey;
  const floor = [{ key: n.floors.preferredKey, index: 0 }],
    room = [...floor, { key: n.rooms.preferredKey, index: 1 }],
    wall = [...room, { key: n.walls.preferredKey, index: 3 }];
  editor.openRow({ path: floor, scopeId: 'floor' });
  editor.apply(
    { type: 'set_defaults', floorId: f.floorId, property: 'wall_height_m', value: 3.2 },
    { scopeId: 'floor' }
  );
  editor.openRow({ path: room, scopeId: 'room', parentScopeId: 'floor' });
  editor.openRow({ path: wall, scopeId: 'wall', parentScopeId: 'room' });
  const before = editor.getSnapshot();
  const operation = {
    type: 'resize_face',
    floorId: f.floorId,
    faceId: f.snapshot.floors[0].rooms[1].faces[3].id,
    distance: -1,
  };
  const conflict = editor.apply(operation, { scopeId: 'wall' });
  assert.equal(
    editor.apply(
      { ...operation, removeOpeningIds: conflict.issues[0].openingIds },
      { scopeId: 'wall' }
    ).status,
    'applied'
  );
  assert.equal(editor.cancelRow('wall').status, 'cancelled');
  assert.deepEqual(editor.getSnapshot(), before);
  assert.equal(editor.getSnapshot().floors[0].defaults.wall_height_m, 3.2);
});
test('confirmed removal cannot discard a separately open opening editor', async () => {
  const f = fixture();
  const { createBuildingPlanEditor } = await import('../src/index.js');
  const editor = createBuildingPlanEditor({ meta: f.meta, record: f.record });
  const n = f.meta.repeatablesByNodeKey;
  let path = [{ key: n.floors.preferredKey, index: 0 }];
  editor.openRow({ path, scopeId: 'floor' });
  for (const [key, index, scopeId, parentScopeId] of [
    [n.rooms.preferredKey, 0, 'room', 'floor'],
    [n.walls.preferredKey, 2, 'wall', 'room'],
    [n.face_doors.preferredKey, 0, 'door', 'wall'],
  ]) {
    path = [...path, { key, index }];
    editor.openRow({ path, scopeId, parentScopeId });
  }
  const before = editor.getSnapshot(),
    operation = {
      type: 'resize_face',
      floorId: f.floorId,
      faceId: f.snapshot.floors[0].rooms[1].faces[3].id,
      distance: -1,
    };
  const issue = editor.apply(operation, { scopeId: 'floor' }).issues[0];
  const result = editor.apply(
    { ...operation, removeOpeningIds: issue.openingIds },
    { scopeId: 'floor' }
  );
  assert.equal(result.status, 'conflict');
  assert.equal(result.issues[0].code, 'opening_editor_active');
  assert.deepEqual(editor.getSnapshot(), before);
  const proposal = editor.preview(
    { ...operation, removeOpeningIds: issue.openingIds },
    { scopeId: 'floor' }
  );
  assert.equal(proposal.status, 'ready');
  assert.equal(editor.commit(proposal).issues[0].code, 'opening_editor_active');
  assert.deepEqual(editor.getSnapshot(), before);
  editor.cancelRow('door');
  assert.equal(
    editor.apply({ ...operation, removeOpeningIds: issue.openingIds }, { scopeId: 'floor' }).status,
    'applied'
  );
});
