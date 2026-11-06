import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import {
  createBuildingPlanSession,
  createBuildingPlanEditor,
  BuildingPlanCanvasController,
  readBuildingPlanRecord,
  writeBuildingPlanRecord,
} from '../src/index.js';
import { buildingPlanFootprints } from '../src/building-plan/footprints.js';
import { pointInPolygon, polygonEdges } from '../src/building-plan/geometry.js';

function fixture(preserveWallGrouping = false, thicknessAnchor = 'room_face') {
  const f = createBuildingPlanExample();
  let serial = 0;
  const initial = readBuildingPlanRecord({ meta: f.meta, record: f.record });
  const session = createBuildingPlanSession({
    snapshot: initial,
    properties: f.meta.properties,
    editingPolicy: { preserveWallGrouping, thicknessAnchor },
    createId: () => `axes-${++serial}`,
  });
  const apply = (op) => {
    const result = session.apply({ floorId: f.floorId, ...op });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    assert.deepEqual(session.validate(), []);
    return session.getSnapshot().floors[0];
  };
  const coherent = () => {
    const snapshot = session.getSnapshot();
    const record = writeBuildingPlanRecord({ meta: f.meta, record: f.record, plan: snapshot });
    assert.deepEqual(readBuildingPlanRecord({ meta: f.meta, record }), snapshot);
    assert.deepEqual(snapshot.floors[0].observations, initial.floors[0].observations);
    assert.equal(snapshot.floors[0].walls.flatMap((w) => w.doors)[0].width, 0.9);
    return snapshot.floors[0];
  };
  return { ...f, session, initial, apply, coherent };
}
function intrusions(floor) {
  const result = [];
  for (const wall of buildingPlanFootprints(floor, 1).wallFootprints)
    for (const polygon of wall.polygons) {
      const mean = polygon.reduce(
        (p, q) => ({ x: p.x + q.x / polygon.length, y: p.y + q.y / polygon.length }),
        { x: 0, y: 0 }
      );
      for (const room of floor.rooms)
        if ([mean, ...polygon].some((p) => pointInPolygon(p, room.vertices, false)))
          result.push({ wall: wall.id, room: room.id });
    }
  return result;
}
function moveWest(f, x) {
  const room = f.session.getSnapshot().floors[0].rooms[1];
  const face = room.faces.find((face) =>
    face.edgeIds.some((id) => {
      const edge = polygonEdges(room).find((e) => e.id === id);
      return Math.abs(edge.start.x - edge.end.x) < 1e-6 && edge.start.y > edge.end.y;
    })
  );
  const edge = polygonEdges(room).find((e) => face.edgeIds.includes(e.id));
  return f.apply({ type: 'resize_face', faceId: face.id, distance: edge.start.x - x });
}
for (const grouped of [false, true])
  test(`a moved midline carries its connected return without intrusive material (${grouped})`, () => {
    const f = fixture(grouped);
    f.apply({ type: 'resize_face', faceId: f.faceB, distance: 0.2 });
    const before = f.session.getSnapshot();
    const floor = moveWest(f, 2.4);
    assert.ok(
      floor.rooms[0].vertices.some((v) => Math.abs(v.x - 2.2) < 1e-6 && Math.abs(v.y - 2.8) < 1e-6),
      'The neighbouring return follows the axis junction, rather than staying at x=2.8.'
    );
    assert.deepEqual(intrusions(floor), []);
    f.coherent();
    f.session.undo();
    assert.deepEqual(f.session.getSnapshot(), before);
    f.session.redo();
    assert.deepEqual(f.session.getSnapshot().floors[0], floor);
    moveWest(f, 3);
    assert.deepEqual(intrusions(f.coherent()), []);
  });

test('semantic grouping alone cannot change derived wall material', () => {
  const floors = [false, true].map((grouped) => {
    const f = fixture(grouped);
    f.apply({ type: 'resize_face', faceId: f.faceB, distance: 0.2 });
    return moveWest(f, 2.4);
  });
  const scenes = floors.map((floor) => buildingPlanFootprints(floor, 1));
  const covers = (scene, p) =>
    scene.wallFootprints.some((w) => w.polygons.some((poly) => pointInPolygon(p, poly)));
  for (let x = 1.8; x <= 3.3; x += 0.05)
    for (let y = 2.5; y <= 3.5; y += 0.05)
      assert.equal(
        covers(scenes[0], { x, y }),
        covers(scenes[1], { x, y }),
        `Grouping changes material at ${x},${y}`
      );
});

for (const anchor of ['room_face', 'midline'])
  test(`thickness change uses the selected ${anchor} anchor and keeps it through history`, () => {
    const f = fixture(false, anchor),
      room = f.initial.floors[0].rooms[0];
    const before = f.session.getSnapshot();
    const floor = f.apply({
      type: 'set_property',
      wallId: f.wallId,
      activeRoomId: room.id,
      property: 'wall_thickness_m',
      value: 0.4,
    });
    const wall = floor.walls.find((w) => w.id === f.wallId);
    assert.ok(
      wall.segments.every((s) => Math.abs(s.start.y - (anchor === 'midline' ? 3.1 : 3.2)) < 1e-6)
    );
    assert.equal(floor.rooms[0].vertices[2].y, anchor === 'midline' ? 2.9 : 3);
    assert.equal(floor.rooms[1].vertices[0].y, anchor === 'midline' ? 3.3 : 3.4);
    f.coherent();
    f.session.undo();
    assert.deepEqual(f.session.getSnapshot(), before);
    f.session.redo();
    assert.deepEqual(f.session.getSnapshot().floors[0], floor);
  });

test('floor-wide midline thickness changes solve all adjoining faces atomically', () => {
  const f = fixture(false, 'midline');
  const floor = f.apply({ type: 'set_defaults', property: 'wall_thickness_m', value: 0.4 });
  assert.deepEqual(
    floor.rooms[0].vertices.map(({ x, y }) => [x, y]),
    [
      [0.1, 0.1],
      [4.9, 0.1],
      [4.9, 2.9],
      [0.1, 2.9],
    ]
  );
  assert.deepEqual(intrusions(floor), []);
  f.coherent();
});

for (const angle of [Math.PI / 2, 0.37])
  for (const sign of [1, -1])
    for (const grouped of [false, true])
      test(`axis incidence is independent of orientation and grouping (${angle}, ${sign}, ${grouped})`, () => {
        const f = fixture(grouped),
          snapshot = f.session.getSnapshot();
        const point = ({ x, y, ...rest }) => ({
          ...rest,
          x: sign * x * Math.cos(angle) - y * Math.sin(angle) || 0,
          y: sign * x * Math.sin(angle) + y * Math.cos(angle) || 0,
        });
        for (const floor of snapshot.floors) {
          for (const room of floor.rooms) {
            room.vertices = room.vertices.map(point);
            for (const face of room.faces)
              for (const binding of face.bindings) binding.side *= sign;
          }
          for (const wall of floor.walls)
            for (const segment of wall.segments) {
              segment.start = point(segment.start);
              segment.end = point(segment.end);
            }
        }
        let n = 0;
        const session = createBuildingPlanSession({
          snapshot,
          properties: f.meta.properties,
          editingPolicy: { preserveWallGrouping: grouped },
          createId: () => `rotated-${++n}`,
        });
        const apply = (op) => {
          const r = session.apply({ floorId: f.floorId, ...op });
          assert.equal(r.status, 'applied', JSON.stringify(r.issues));
        };
        apply({ type: 'resize_face', faceId: f.faceB, distance: 0.2 });
        apply({
          type: 'resize_face',
          faceId: snapshot.floors[0].rooms[1].faces[3].id,
          distance: 0.6,
        });
        assert.deepEqual(intrusions(session.getSnapshot().floors[0]), []);
        const plan = session.getSnapshot();
        assert.deepEqual(
          readBuildingPlanRecord({
            meta: f.meta,
            record: writeBuildingPlanRecord({ meta: f.meta, record: f.record, plan }),
          }),
          plan
        );
        assert.deepEqual(session.validate(), []);
      });

for (const anchor of ['room_face', 'midline'])
  test(`ordinary wall row editing uses ${anchor}, with complete nested cancellation`, () => {
    const f = fixture(),
      editor = createBuildingPlanEditor({ meta: f.meta, record: f.record });
    const nodes = f.meta.repeatablesByNodeKey;
    const floorPath = [{ key: nodes.floors.preferredKey, index: 0 }],
      roomPath = [...floorPath, { key: nodes.rooms.preferredKey, index: 0 }];
    const wallPath = [...roomPath, { key: nodes.walls.preferredKey, index: 2 }];
    const before = editor.getSnapshot();
    editor.openRow({ path: floorPath, scopeId: 'floor' });
    editor.openRow({ path: roomPath, scopeId: 'room', parentScopeId: 'floor' });
    const wall = editor.openRow({ path: wallPath, scopeId: 'wall', parentScopeId: 'room' });
    const record = editor.getRecord();
    editor.setEditingPolicy({ thicknessAnchor: anchor });
    assert.deepEqual(
      editor.getRecord(),
      record,
      'Changing a preference is not a collected answer.'
    );
    const row = structuredClone(wall.row);
    const field = nodes.walls.fields.find((f) => f.binding?.property === 'wall_thickness_m');
    row.values[field.dataName] = 0.4;
    const result = editor.updateRow('wall', row);
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    assert.equal(
      editor.getSnapshot().floors[0].rooms[0].vertices[2].y,
      anchor === 'midline' ? 2.9 : 3
    );
    assert.equal(editor.cancelRow('wall').status, 'cancelled');
    assert.deepEqual(editor.getSnapshot(), before);
    editor.cancelRow('room');
    editor.cancelRow('floor');
    assert.deepEqual(editor.getSnapshot(), before);
  });

test('canvas proposals and commits use the current thickness anchor without persisting preferences', async () => {
  const f = fixture();
  let record = f.record;
  const controller = new BuildingPlanCanvasController({
    meta: f.meta,
    readRecord: () => record,
    writeRecord: (next) => {
      record = next;
      return true;
    },
  });
  const before = structuredClone(record),
    history = controller.session.getState();
  controller.setEditingPolicy({ thicknessAnchor: 'midline' });
  assert.deepEqual(record, before);
  assert.deepEqual(controller.session.getState(), history);
  const operation = {
    type: 'set_property',
    floorId: f.floorId,
    wallId: f.wallId,
    activeRoomId: f.initial.floors[0].rooms[0].id,
    property: 'wall_thickness_m',
    value: 0.4,
  };
  const proposal = controller.previewOperation(operation);
  assert.equal(proposal.status, 'ready');
  assert.equal(proposal.snapshot.floors[0].rooms[0].vertices[2].y, 2.9);
  assert.deepEqual(record, before);
  assert.equal((await controller.apply(operation)).status, 'applied');
  assert.equal(
    readBuildingPlanRecord({ meta: f.meta, record }).floors[0].rooms[0].vertices[2].y,
    2.9
  );
  controller.dispose();
});

for (const grouped of [false, true])
  test(`a reversed split diagonal cannot cross stationary construction at its held cut (${grouped})`, () => {
    const f = fixture(grouped);
    f.apply({ type: 'split_face', faceId: f.faceB, offset: 2 });
    f.apply({ type: 'resize_face', faceId: f.faceB, distance: 1 });
    const room = f.session.getSnapshot().floors[0].rooms[1];
    f.apply({
      type: 'move_corner',
      roomId: room.id,
      vertexId: room.vertices[0].id,
      point: { x: 3, y: 2.8 },
    });
    const before = f.session.getSnapshot(),
      history = f.session.getState();
    const result = f.session.apply({
      floorId: f.floorId,
      type: 'resize_face',
      faceId: f.faceB,
      distance: -1.5325220563538426,
    });
    assert.equal(result.status, 'conflict');
    assert.equal(result.issues[0].code, 'wall_clearance_conflict');
    assert.match(result.issues[0].message, /smaller drag|adjoining portion/);
    assert.deepEqual(f.session.getSnapshot(), before);
    assert.deepEqual(f.session.getState(), history);
  });

for (const grouped of [false, true])
  test(`split jogs and short thickness-profile shoulders do not intrude into room clearance (${grouped})`, () => {
    const f = fixture(grouped);
    f.apply({ type: 'split_face', faceId: f.faceA, offset: 1.5 });
    f.apply({ type: 'resize_face', faceId: f.faceA, distance: 0.6 });
    assert.deepEqual(intrusions(f.coherent()), []);
    f.apply({ type: 'resize_face', faceId: f.faceA, distance: -0.6 });
    assert.deepEqual(intrusions(f.coherent()), []);
    const g = fixture(grouped);
    g.apply({ type: 'split_face', faceId: g.faceB, offset: 2 });
    const face = g.session
      .getSnapshot()
      .floors[0].rooms[1].faces.find((face) => face.wallId === g.wallId && face.id !== g.faceB);
    g.apply({ type: 'set_property', faceId: face.id, property: 'wall_thickness_m', value: 0.4 });
    g.apply({ type: 'set_defaults', property: 'wall_thickness_m', value: 0.3 });
    assert.deepEqual(intrusions(g.coherent()), []);
  });

test('corner position input cannot replace vertex identity or cut metadata', () => {
  const f = fixture(),
    room = f.initial.floors[0].rooms[1],
    vertex = room.vertices[2];
  const floor = f.apply({
    type: 'move_corner',
    roomId: room.id,
    vertexId: vertex.id,
    point: { x: 9, y: 6.2, id: 'replacement', editingCutId: 'invented' },
  });
  const next = floor.rooms[1].vertices.find((v) => v.id === vertex.id);
  assert.ok(next);
  assert.equal(next.x, 9);
  assert.ok(!next.editingCutId);
  assert.deepEqual(
    floor.rooms[1].vertices.map((v) => v.id),
    room.vertices.map((v) => v.id)
  );
});

for (const direction of [-1, 1])
  for (const grouped of [false, true])
    test(`a shared Split node reshapes and returns with its cut identity (${direction}, ${grouped})`, () => {
      const f = fixture(grouped);
      const cut = f.session.apply({
        type: 'split_face',
        floorId: f.floorId,
        faceId: f.faceA,
        offset: 1.5,
      }).created.id;
      const before = f.session.getSnapshot(),
        room = before.floors[0].rooms[0],
        vertex = room.vertices.find((v) => v.editingCutId === cut);
      const operation = { type: 'move_corner', roomId: room.id, vertexId: vertex.id };
      f.apply({ ...operation, point: { x: vertex.x, y: vertex.y + direction * 0.6 } });
      assert.deepEqual(intrusions(f.coherent()), []);
      assert.equal(
        f.session
          .getSnapshot()
          .floors[0].rooms[1].vertices.find(
            (v) => v.id === before.floors[0].rooms[1].vertices.at(-2).id
          ).x,
        8
      );
      f.apply({ ...operation, point: { x: vertex.x, y: vertex.y } });
      const restored = f.coherent();
      for (const [i, room] of restored.rooms.entries()) {
        assert.deepEqual(
          room.vertices.map((v) => v.id),
          before.floors[0].rooms[i].vertices.map((v) => v.id)
        );
        for (const [j, v] of room.vertices.entries()) {
          const old = before.floors[0].rooms[i].vertices[j];
          assert.ok(Math.abs(v.x - old.x) < 1e-6 && Math.abs(v.y - old.y) < 1e-6);
        }
        assert.ok(room.vertices.some((v) => v.editingCutId === cut));
      }
      f.apply({ type: 'rejoin_cut', cutId: cut });
      assert.ok(
        f.session.getSnapshot().floors[0].rooms.every((room) => room.vertices.length === 4)
      );
    });
