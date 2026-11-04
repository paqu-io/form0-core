import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBuildingPlanSession,
  createBuildingPlanEditor,
  buildingPlanCanvasSnapshot,
  BuildingPlanCanvasController,
  readBuildingPlanRecord,
  writeBuildingPlanRecord,
} from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

function fixture() {
  const f = createBuildingPlanExample();
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    createId: () => `cut-test-${++serial}`,
  });
  const apply = (operation) => {
    const result = session.apply({ floorId: f.floorId, ...operation });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    return result;
  };
  return { ...f, session, apply };
}

test('an editing cut adds shared facing rows while retaining one physical wall and original evidence', () => {
  const f = fixture();
  f.apply({ type: 'set_property', faceId: f.faceA, property: 'finish', value: 'painted' });
  f.apply({ type: 'set_property', faceId: f.faceB, property: 'finish', value: 'paper' });
  const before = f.session.getSnapshot().floors[0];
  const result = f.apply({ type: 'split_face', faceId: f.faceA, offset: 1.5 });
  const after = f.session.getSnapshot().floors[0];
  assert.equal(after.walls.length, 7);
  assert.deepEqual(after.walls, before.walls);
  assert.deepEqual(after.observations, before.observations);
  for (const room of after.rooms) {
    assert.equal(room.faces.length, 5);
    const cut = room.vertices.find((point) => point.editingCutId === result.created.id);
    assert.ok(cut);
    assert.equal(cut.x, 3.5);
    assert.equal(cut.y, room.id === after.rooms[0].id ? 3 : 3.2);
    assert.equal(room.faces.filter((face) => face.wallId === f.wallId).length, 2);
    assert.ok(
      room.faces
        .filter((face) => face.wallId === f.wallId)
        .every(
          (face) => face.overrides.finish === (room.id === after.rooms[0].id ? 'painted' : 'paper')
        )
    );
  }
  const record = writeBuildingPlanRecord({ meta: f.meta, plan: f.session.getSnapshot() });
  const restored = readBuildingPlanRecord({ meta: f.meta, record });
  assert.deepEqual(
    restored.floors[0].rooms.map((room) => room.vertices),
    after.rooms.map((room) => room.vertices)
  );
  assert.deepEqual(
    restored.floors[0].rooms.map((room) => room.faces.map((face) => face.overrides.finish)),
    after.rooms.map((room) => room.faces.map((face) => face.overrides.finish))
  );
  assert.deepEqual(f.session.validate(), []);
});

test('moving a split portion creates an orthogonal local jog and keeps the explicit cut after realignment', () => {
  const f = fixture();
  const cut = f.apply({ type: 'split_face', faceId: f.faceA, offset: 1.5 }).created.id;
  f.apply({ type: 'resize_face', faceId: f.faceA, distance: 0.6 });
  const moved = f.session.getSnapshot().floors[0];
  for (const room of moved.rooms)
    for (const edge of room.edges) {
      const a = room.vertices.find((v) => v.id === edge.startId);
      const b = room.vertices.find((v) => v.id === edge.endId);
      assert.ok(
        a.x === b.x || a.y === b.y,
        'A local edit must leave straight orthogonal boundaries.'
      );
    }
  const room = moved.rooms[0];
  assert.ok(room.vertices.some((v) => v.x === 0 && v.y === 3));
  const movingEdge = room.edges.find((edge) =>
    [edge.startId, edge.endId].every((id) => room.vertices.find((v) => v.id === id).y === 3.6)
  );
  const movingFace = room.faces.find((face) => face.edgeIds.includes(movingEdge.id));
  f.apply({ type: 'resize_face', faceId: movingFace.id, distance: -0.6 });
  for (const restored of f.session.getSnapshot().floors[0].rooms) {
    assert.ok(restored.vertices.some((v) => v.editingCutId === cut));
    assert.equal(restored.vertices.length, 5);
  }
  f.apply({ type: 'rejoin_cut', cutId: cut });
  assert.ok(f.session.getSnapshot().floors[0].rooms.every((room) => room.faces.length === 4));
});

test('Rejoin removes a compatible shared cut atomically and Undo restores its rows and identity', () => {
  const f = fixture();
  const cutId = f.apply({ type: 'split_face', faceId: f.faceA, offset: 1.5 }).created.id;
  const split = f.session.getSnapshot();
  f.apply({ type: 'rejoin_cut', cutId });
  const joined = f.session.getSnapshot();
  for (const room of joined.floors[0].rooms) {
    assert.equal(room.vertices.length, 4);
    assert.equal(room.faces.length, 4);
  }
  assert.deepEqual(joined.floors[0].walls, f.snapshot.floors[0].walls);
  assert.deepEqual(joined.floors[0].observations, f.snapshot.floors[0].observations);
  assert.equal(f.session.undo().status, 'undone');
  assert.deepEqual(f.session.getSnapshot(), split);
  assert.equal(f.session.redo().status, 'redone');
  assert.deepEqual(f.session.getSnapshot(), joined);
});

test('Rejoin rejects a jog and differing room-side answers without dropping either cut or answer', () => {
  const f = fixture();
  const cutId = f.apply({ type: 'split_face', faceId: f.faceA, offset: 1.5 }).created.id;
  const cut = f.session.getSnapshot();
  f.apply({ type: 'resize_face', faceId: f.faceA, distance: 0.6 });
  const bent = f.session.getSnapshot();
  let rejected = f.session.apply({ type: 'rejoin_cut', floorId: f.floorId, cutId });
  assert.equal(rejected.issues[0].code, 'cut_not_aligned');
  assert.deepEqual(f.session.getSnapshot(), bent);
  f.session.undo();
  assert.deepEqual(f.session.getSnapshot(), cut);
  const other = cut.floors[0].rooms[0].faces.find(
    (face) => face.wallId === f.wallId && face.id !== f.faceA
  );
  f.apply({ type: 'set_values', faceId: other.id, values: { finish: 'painted' } });
  const answers = f.session.getSnapshot();
  rejected = f.session.apply({ type: 'rejoin_cut', floorId: f.floorId, cutId });
  assert.equal(rejected.issues[0].code, 'cut_answer_conflict');
  assert.deepEqual(f.session.getSnapshot(), answers);
});

test('Rejoin targets only the chosen cut and preserves a second explicit division', () => {
  const f = fixture();
  const faceId = f.snapshot.floors[0].rooms[0].faces[0].id;
  const first = f.apply({ type: 'split_face', faceId, offset: 2 }).created.id;
  const room = f.session.getSnapshot().floors[0].rooms[0];
  const secondFace = room.faces.find(
    (face) =>
      face.id !== faceId && face.wallId === room.faces.find((face) => face.id === faceId).wallId
  );
  const second = f.apply({ type: 'split_face', faceId: secondFace.id, offset: 1 }).created.id;
  f.apply({ type: 'rejoin_cut', cutId: first });
  const joined = f.session.getSnapshot().floors[0].rooms[0];
  assert.equal(joined.vertices.length, 5);
  assert.ok(!joined.vertices.some((point) => point.editingCutId === first));
  assert.ok(joined.vertices.some((point) => point.editingCutId === second && point.x === 3));
});

test('cuts through openings and at endpoints are rejected atomically; an opening edge is allowed', () => {
  const f = fixture();
  const before = f.session.getSnapshot();
  for (const [offset, code] of [
    [1, 'opening_crosses_cut'],
    [0, 'invalid_cut'],
    [5, 'invalid_cut'],
    [NaN, 'invalid_cut'],
  ]) {
    const rejected = f.session.apply({
      type: 'split_face',
      floorId: f.floorId,
      faceId: f.faceA,
      offset,
    });
    assert.equal(rejected.issues[0].code, code);
    assert.deepEqual(f.session.getSnapshot(), before);
  }
  f.apply({ type: 'split_face', faceId: f.faceA, offset: 0.5 });
  assert.deepEqual(f.session.getSnapshot().floors[0].walls, before.floors[0].walls);
});

test('an internal straight partition supports editing cuts and Rejoin without duplicating construction', () => {
  const f = fixture();
  const wallId = f.apply({
    type: 'create_wall',
    roomId: f.snapshot.floors[0].rooms[0].id,
    vertices: [
      { x: 1, y: 1 },
      { x: 4, y: 1 },
    ],
  }).created.id;
  const before = f.session.getSnapshot().floors[0];
  const faceId = before.rooms[0].faces.find((face) => face.wallId === wallId).id;
  const cutId = f.apply({ type: 'split_face', faceId, offset: 1 }).created.id;
  const divided = f.session.getSnapshot().floors[0];
  assert.equal(divided.walls.length, before.walls.length);
  assert.equal(divided.rooms[0].faces.length, before.rooms[0].faces.length + 1);
  f.apply({ type: 'rejoin_cut', cutId });
  assert.equal(
    f.session.getSnapshot().floors[0].rooms[0].faces.length,
    before.rooms[0].faces.length
  );
  assert.deepEqual(f.session.validate(), []);
});

test('detaching a room gives its copied cuts independent identities and Rejoin leaves the stationary cuts intact', () => {
  const f = fixture();
  const cutId = f.apply({ type: 'split_face', faceId: f.faceA, offset: 1.5 }).created.id;
  f.apply({ type: 'move_room', roomId: f.snapshot.floors[0].rooms[0].id, delta: { x: -10, y: 0 } });
  const floor = f.session.getSnapshot().floors[0];
  const copied = floor.rooms[0].vertices.find((v) => v.editingCutId).editingCutId;
  assert.notEqual(copied, cutId);
  f.apply({ type: 'rejoin_cut', cutId: copied });
  assert.equal(f.session.getSnapshot().floors[0].rooms[0].vertices.length, 4);
  assert.ok(
    f.session.getSnapshot().floors[0].rooms[1].vertices.some((v) => v.editingCutId === cutId)
  );
});

test('canvas split placement projects magnetic nodes, supports precise bypass, and commits once without navigation', async () => {
  const f = fixture();
  let record = f.record,
    writes = 0,
    focuses = 0,
    locked = false;
  const controller = new BuildingPlanCanvasController({
    meta: f.meta,
    readRecord: () => record,
    writeRecord: (next) => {
      record = next;
      writes++;
    },
    focusRow: () => focuses++,
    readOnly: () => locked,
  });
  const roomId = f.snapshot.floors[0].rooms[0].id;
  const faceId = f.snapshot.floors[0].rooms[0].faces[0].id;
  const snapped = controller.getCutPlacement({ x: 58, y: 0 }, { roomId, wallId: faceId });
  assert.deepEqual(snapped.point, { x: 60, y: 0 });
  assert.equal(snapped.offset, 3);
  assert.equal(snapped.snapped, true);
  assert.equal(
    controller.getCutPlacement({ x: 58, y: 0 }, { roomId, wallId: faceId, bypass: true }).offset,
    2.9
  );
  assert.equal(writes, 0);
  await controller.splitWall(faceId, { offset: 3 });
  assert.equal(writes, 1);
  const cut = controller.getJoinPlacement({ x: 60, y: 0 }, { roomId });
  assert.ok(cut);
  await controller.rejoinCut(cut.id);
  assert.equal(writes, 2);
  assert.equal(focuses, 0);
  locked = true;
  assert.equal(await controller.splitWall(faceId, { offset: 2 }), null);
  assert.equal(writes, 2);
  controller.dispose();
});

test('a child Cancel restores shared cuts without losing earlier floor defaults', () => {
  const f = fixture();
  f.session.beginScope({ id: 'floor' });
  assert.equal(
    f.session.apply(
      { type: 'set_defaults', floorId: f.floorId, property: 'wall_height_m', value: 3.4 },
      { scopeId: 'floor' }
    ).status,
    'applied'
  );
  const before = f.session.getSnapshot();
  assert.equal(before.floors[0].defaults.wall_height_m, 3.4);
  f.session.beginScope({ id: 'child', parentScopeId: 'floor' });
  const split = f.session.apply(
    { type: 'split_face', floorId: f.floorId, faceId: f.faceA, offset: 1.5 },
    { scopeId: 'child' }
  );
  assert.equal(split.status, 'applied');
  assert.equal(f.session.cancelScope('child').status, 'cancelled');
  assert.deepEqual(f.session.getSnapshot(), before);
});

test('Rejoin remaps retired facing and vertex observations while preserving captured evidence', () => {
  const f = fixture();
  const cutId = f.apply({ type: 'split_face', faceId: f.faceA, offset: 1.5 }).created.id;
  const room = f.session.getSnapshot().floors[0].rooms[0];
  const other = room.faces.find((face) => face.wallId === f.wallId && face.id !== f.faceA);
  const vertex = room.vertices.find((v) => v.editingCutId === cutId);
  for (const subject of [
    { type: 'room_face', id: other.id },
    { type: 'vertex', id: vertex.id },
  ])
    f.apply({
      type: 'add_observation',
      subject,
      observedAt: '2026-11-04T12:00:00Z',
      evidence: [{ reference: 'fixture://cut' }],
      values: { note: 'original' },
    });
  const original = f.session.getSnapshot().floors[0].observations.slice(-2);
  f.apply({ type: 'rejoin_cut', cutId });
  const after = f.session.getSnapshot().floors[0].observations.slice(-2);
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(after[i].sourceSubject, original[i].sourceSubject);
    assert.deepEqual(after[i].sourceGeometry, original[i].sourceGeometry);
    assert.deepEqual(after[i].evidence, original[i].evidence);
    assert.deepEqual(after[i].values, original[i].values);
    assert.equal(after[i].subject.id, f.faceA);
  }
  assert.deepEqual(f.session.validate(), []);
});

for (const partition of [false, true])
  test(`Split retains observations targeting the replaced edge (partition=${partition})`, () => {
    const f = fixture();
    let faceId = f.faceA;
    if (partition) {
      const wallId = f.apply({
        type: 'create_wall',
        roomId: f.snapshot.floors[0].rooms[0].id,
        vertices: [
          { x: 1, y: 1 },
          { x: 4, y: 1 },
        ],
      }).created.id;
      faceId = f.session
        .getSnapshot()
        .floors[0].rooms[0].faces.find((face) => face.wallId === wallId).id;
    }
    const face = f.session
      .getSnapshot()
      .floors[0].rooms[0].faces.find((face) => face.id === faceId);
    const edgeId = (face.freeEdges || face.edgeIds)[0];
    f.apply({
      type: 'add_observation',
      subject: { type: 'edge', id: edgeId },
      observedAt: '2026-11-04T12:00:00Z',
      evidence: [{ reference: 'fixture://original-edge' }],
      values: { measured_thickness: 0.19 },
      sourceGeometry: {
        basis: 'survey',
        vertices: face.freePath || f.snapshot.floors[0].rooms[0].vertices,
      },
    });
    const original = f.session.getSnapshot().floors[0].observations.at(-1);
    const cutId = f.apply({ type: 'split_face', faceId, offset: 1.5 }).created.id;
    const after = f.session.getSnapshot().floors[0].observations.at(-1);
    assert.deepEqual(after.subject, { type: 'room_face', id: faceId });
    for (const key of ['sourceSubject', 'sourceGeometry', 'evidence', 'values', 'observedAt'])
      assert.deepEqual(after[key], original[key]);
    const record = writeBuildingPlanRecord({ meta: f.meta, plan: f.session.getSnapshot() });
    assert.deepEqual(
      readBuildingPlanRecord({ meta: f.meta, record }).floors[0].observations.at(-1),
      after
    );
    f.apply({ type: 'rejoin_cut', cutId });
    assert.deepEqual(f.session.getSnapshot().floors[0].observations.at(-1), after);
    assert.deepEqual(f.session.validate(), []);
  });

test('live thickness changes preserve explicit cuts and readonly sessions refuse both commands', () => {
  const f = fixture();
  const cutId = f.apply({ type: 'split_face', faceId: f.faceA, offset: 1.5 }).created.id;
  f.apply({
    type: 'set_property',
    wallId: f.wallId,
    activeRoomId: f.snapshot.floors[0].rooms[0].id,
    property: 'wall_thickness_m',
    value: 0.3,
  });
  assert.ok(
    f.session
      .getSnapshot()
      .floors[0].rooms.every((room) => room.vertices.some((v) => v.editingCutId === cutId))
  );
  const locked = createBuildingPlanSession({
    snapshot: f.session.getSnapshot(),
    properties: f.meta.properties,
    readOnly: true,
  });
  for (const operation of [
    { type: 'split_face', faceId: f.faceA, offset: 1 },
    { type: 'rejoin_cut', cutId },
  ])
    assert.equal(locked.apply({ floorId: f.floorId, ...operation }).status, 'blocked');
});

test('malformed persisted cut identities are rejected in boundary and partition vertices', () => {
  const f = fixture();
  f.apply({
    type: 'create_wall',
    roomId: f.snapshot.floors[0].rooms[0].id,
    vertices: [
      { x: 1, y: 1 },
      { x: 4, y: 1 },
    ],
  });
  for (const partition of [false, true]) {
    const invalid = f.session.getSnapshot();
    const room = invalid.floors[0].rooms[0];
    const point = partition
      ? room.faces.find((face) => face.freePath).freePath[0]
      : room.vertices[0];
    point.editingCutId = 42;
    assert.throws(
      () => createBuildingPlanSession({ snapshot: invalid, properties: f.meta.properties }),
      /editing cut/i
    );
  }
});

test('an editing cut can revisit a previously joined straight wall position', () => {
  const f = fixture();
  const wallId = f.snapshot.floors[0].rooms[0].faces[0].wallId;
  f.apply({ type: 'split_wall', wallId, offset: 2 });
  const other = f.session
    .getSnapshot()
    .floors[0].walls.find((wall) => wall.lineage?.splitFromWallId === wallId);
  f.apply({ type: 'join_walls', wallId, otherWallId: other.id });
  f.apply({
    type: 'resize_face',
    faceId: f.snapshot.floors[0].rooms[0].faces[3].id,
    distance: 0.1,
  });
  const cutFace = f.session
    .getSnapshot()
    .floors[0].rooms[0].faces.find((face) => face.wallId === wallId);
  const result = f.apply({ type: 'split_face', faceId: cutFace.id, offset: 2.1 });
  assert.ok(
    f.session
      .getSnapshot()
      .floors[0].rooms[0].vertices.some((v) => v.editingCutId === result.created.id && v.x === 2)
  );
});

test('a wall editor opened by position retains its subject when Split inserts an earlier wall row', () => {
  const f = fixture();
  const editor = createBuildingPlanEditor({ meta: f.meta, record: f.record });
  const nodes = f.meta.repeatablesByNodeKey;
  const path = [
    { key: nodes.floors.preferredKey, index: 0 },
    { key: nodes.rooms.preferredKey, index: 0 },
    { key: nodes.walls.preferredKey, index: 3 },
  ];
  const opened = editor.openRow({ path, scopeId: 'west' });
  assert.equal(opened.status, 'opened');
  const westId = f.snapshot.floors[0].rooms[0].faces[3].id;
  assert.equal(
    editor.apply({ type: 'split_face', floorId: f.floorId, faceId: f.faceA, offset: 1.5 }).status,
    'applied'
  );
  const edited = structuredClone(opened.row);
  edited.values[nodes.walls.fieldsByOriginalDataName.finish.dataName] = 'kept';
  const result = editor.updateRow('west', edited);
  assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  assert.equal(
    editor.getSnapshot().floors[0].rooms[0].faces.find((face) => face.id === westId).overrides
      .finish,
    'kept'
  );
  assert.equal(editor.cancelRow('west').status, 'cancelled');
  assert.equal(
    editor.getSnapshot().floors[0].rooms[0].faces.find((face) => face.id === westId).overrides
      .finish,
    undefined
  );
  assert.ok(editor.getSnapshot().floors[0].rooms.every((room) => room.faces.length === 5));
});

test('Rejoin cannot retire a wall row with an open editor, and succeeds after that editor closes', () => {
  const f = fixture();
  const editor = createBuildingPlanEditor({ meta: f.meta, record: f.record });
  const split = editor.apply({
    type: 'split_face',
    floorId: f.floorId,
    faceId: f.faceA,
    offset: 1.5,
  });
  const cutId = split.created.id;
  const nodes = f.meta.repeatablesByNodeKey;
  const path = [
    { key: nodes.floors.preferredKey, index: 0 },
    { key: nodes.rooms.preferredKey, index: 0 },
    { key: nodes.walls.preferredKey, index: 3 },
  ];
  assert.equal(editor.openRow({ path, scopeId: 'other' }).status, 'opened');
  const before = editor.getSnapshot();
  const blocked = editor.apply({ type: 'rejoin_cut', floorId: f.floorId, cutId });
  assert.equal(blocked.status, 'conflict');
  assert.equal(blocked.issues[0].code, 'wall_editor_active');
  assert.deepEqual(editor.getSnapshot(), before);
  assert.equal(editor.acceptRow('other').status, 'accepted');
  assert.equal(editor.apply({ type: 'rejoin_cut', floorId: f.floorId, cutId }).status, 'applied');
});

for (const preserveWallGrouping of [false, true])
  for (const movingRight of [false, true])
    test(`a split internal partition moves locally, keeps its cut after straightening, and Rejoins (grouped=${preserveWallGrouping}, right=${movingRight})`, () => {
      const f = fixture();
      f.session.setEditingPolicy({ preserveWallGrouping });
      const wallId = f.apply({
        type: 'create_wall',
        roomId: f.snapshot.floors[0].rooms[0].id,
        vertices: [
          { x: 1, y: 1 },
          { x: 4, y: 1 },
        ],
      }).created.id;
      const openingId = f.apply({
        type: 'create_opening',
        wallId,
        kind: 'window',
        offset: 1.5,
        width: 0.6,
        height: 1,
        sillHeight: 1,
      }).created.id;
      const first = f.session
        .getSnapshot()
        .floors[0].rooms[0].faces.find((face) => face.wallId === wallId);
      const cutId = f.apply({ type: 'split_face', faceId: first.id, offset: 1 }).created.id;
      const second = f.session
        .getSnapshot()
        .floors[0].rooms[0].faces.find((face) => face.wallId === wallId && face.id !== first.id);
      const moving = movingRight ? second : first,
        stationary = movingRight ? first : second;
      const xs = movingRight ? [2, 4] : [1, 2];
      f.apply({
        type: 'update_wall',
        wallId,
        faceId: moving.id,
        vertices: xs.map((x) => ({ x, y: 1.5 })),
      });
      let floor = f.session.getSnapshot().floors[0];
      assert.equal(floor.rooms[0].faces.filter((face) => face.freePath).length, 3);
      assert.equal(floor.walls.length, preserveWallGrouping ? 8 : 10);
      assert.ok(
        floor.rooms[0].faces
          .find((face) => face.id === stationary.id)
          .freePath.every((point) => point.y === 1)
      );
      const record = writeBuildingPlanRecord({ meta: f.meta, plan: f.session.getSnapshot() });
      const scene = buildingPlanCanvasSnapshot({
        meta: f.meta,
        record,
        plan: f.session.getSnapshot(),
        gridSize: 1,
      });
      const covers = (point) =>
        scene.wallFootprints.some((wall) =>
          wall.polygons.some((polygon) => {
            const sides = polygon.map((a, index) => {
              const b = polygon[(index + 1) % polygon.length];
              return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
            });
            return sides.every((value) => value >= -1e-6) || sides.every((value) => value <= 1e-6);
          })
        );
      assert.ok(
        covers({ x: movingRight ? 2.1 : 1.9, y: 0.9 }),
        'The partition return has continuous corner material.'
      );
      assert.ok(!covers({ x: movingRight ? 1.9 : 2.1, y: 1.1 }));
      assert.ok(
        readBuildingPlanRecord({ meta: f.meta, record }).floors[0].rooms[0].faces.some(
          (face) => face.lineage?.editingReturn
        )
      );
      assert.deepEqual(f.session.validate(), []);
      const moved = f.session.getSnapshot();
      assert.equal(f.session.undo().status, 'undone');
      assert.equal(f.session.redo().status, 'redone');
      assert.deepEqual(f.session.getSnapshot(), moved);
      const selected = floor.rooms[0].faces.find((face) => face.id === moving.id);
      f.apply({
        type: 'update_wall',
        wallId: selected.wallId,
        faceId: moving.id,
        vertices: xs.map((x) => ({ x, y: 1 })),
      });
      floor = f.session.getSnapshot().floors[0];
      assert.equal(floor.rooms[0].faces.filter((face) => face.freePath).length, 2);
      assert.ok(
        floor.rooms[0].faces.some((face) =>
          face.freePath?.some((point) => point.editingCutId === cutId)
        )
      );
      f.apply({ type: 'rejoin_cut', cutId });
      assert.equal(
        f.session.getSnapshot().floors[0].rooms[0].faces.filter((face) => face.freePath).length,
        1
      );
      assert.equal(f.session.getSnapshot().floors[0].walls.length, 8);
      const opening = f.session
        .getSnapshot()
        .floors[0].walls.flatMap((wall) => wall.windows)
        .find((opening) => opening.id === openingId);
      assert.equal(opening.width, 0.6);
      assert.equal(opening.offset, 1.5);
      assert.deepEqual(f.session.validate(), []);
    });

test('straightening a partition return offers the existing explicit opening-removal resolution', () => {
  const f = fixture();
  const wallId = f.apply({
    type: 'create_wall',
    roomId: f.snapshot.floors[0].rooms[0].id,
    vertices: [
      { x: 1, y: 1 },
      { x: 4, y: 1 },
    ],
  }).created.id;
  const first = f.session
    .getSnapshot()
    .floors[0].rooms[0].faces.find((face) => face.wallId === wallId);
  f.apply({ type: 'split_face', faceId: first.id, offset: 1 });
  const second = f.session
    .getSnapshot()
    .floors[0].rooms[0].faces.find((face) => face.wallId === wallId && face.id !== first.id);
  f.apply({
    type: 'update_wall',
    wallId,
    faceId: second.id,
    vertices: [
      { x: 2, y: 1.6 },
      { x: 4, y: 1.6 },
    ],
  });
  let floor = f.session.getSnapshot().floors[0];
  const connector = floor.rooms[0].faces.find((face) => face.lineage?.editingReturn);
  const openingId = f.apply({
    type: 'create_opening',
    wallId: connector.wallId,
    kind: 'window',
    offset: 0.1,
    width: 0.2,
    height: 1,
    sillHeight: 1,
  }).created.id;
  const before = f.session.getSnapshot();
  floor = before.floors[0];
  const operation = {
    type: 'update_wall',
    floorId: f.floorId,
    wallId: floor.rooms[0].faces.find((face) => face.id === second.id).wallId,
    faceId: second.id,
    vertices: [
      { x: 2, y: 1 },
      { x: 4, y: 1 },
    ],
  };
  const rejected = f.session.apply(operation);
  assert.equal(rejected.issues[0].code, 'opening_cut_requires_confirmation');
  assert.deepEqual(rejected.issues[0].openingIds, [openingId]);
  assert.deepEqual(f.session.getSnapshot(), before);
  f.apply({ ...operation, removeOpeningIds: [openingId] });
  assert.ok(
    !f.session
      .getSnapshot()
      .floors[0].walls.flatMap((wall) => wall.windows)
      .some((opening) => opening.id === openingId)
  );
  f.session.undo();
  assert.deepEqual(f.session.getSnapshot(), before);
});
