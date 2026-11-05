import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import {
  createBuildingPlanSession,
  readBuildingPlanRecord,
  writeBuildingPlanRecord,
} from '../src/index.js';

function fixture(editingPolicy) {
  const f = createBuildingPlanExample();
  let serial = 0;
  const snapshot = readBuildingPlanRecord({ meta: f.meta, record: f.record });
  const session = createBuildingPlanSession({
    snapshot,
    properties: f.meta.properties,
    editingPolicy,
    createId: () => `corner-${++serial}`,
  });
  const apply = (op) => {
    const result = session.apply({ floorId: f.floorId, ...op });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    return result;
  };
  return { ...f, snapshot, session, apply };
}
for (const axis of ['x', 'y'])
  test(`one corner reshapes adjoining walls while a pinned opposite wall stays fixed (${axis})`, () => {
    const f = fixture(),
      room = f.snapshot.floors[0].rooms[1],
      corner = room.vertices[2];
    const before = f.session.getSnapshot();
    f.apply({
      type: 'move_corner',
      roomId: room.id,
      vertexId: corner.id,
      point: { x: corner.x + (axis === 'x' ? 1 : 0), y: corner.y + (axis === 'y' ? 1 : 0) },
      pinnedFaceIds: [room.faces[0].id],
    });
    const after = f.session.getSnapshot(),
      next = after.floors[0].rooms[1];
    assert.deepEqual(
      next.vertices.filter((v) => v.id !== corner.id),
      room.vertices.filter((v) => v.id !== corner.id)
    );
    assert.deepEqual(after.floors[0].rooms[0], before.floors[0].rooms[0]);
    assert.deepEqual(f.session.validate(), []);
    const record = writeBuildingPlanRecord({ meta: f.meta, record: f.record, plan: after });
    assert.deepEqual(readBuildingPlanRecord({ meta: f.meta, record }), after);
    f.session.undo();
    assert.deepEqual(f.session.getSnapshot(), before);
    f.session.redo();
    assert.deepEqual(f.session.getSnapshot(), after);
  });
test('a shared corner rotates only the bound neighbour extent with coherent physical bindings', () => {
  const f = fixture(),
    room = f.snapshot.floors[0].rooms[1],
    corner = room.vertices[0];
  f.apply({
    type: 'move_corner',
    roomId: room.id,
    vertexId: corner.id,
    point: { x: corner.x, y: 2.6 },
  });
  const after = f.session.getSnapshot();
  assert.ok(after.floors[0].rooms[0].vertices.some((v) => v.x === 0 && v.y === 3));
  assert.deepEqual(f.session.validate(), []);
  assert.deepEqual(after.floors[0].observations, f.snapshot.floors[0].observations);
  const door = after.floors[0].walls.flatMap((w) => w.doors)[0];
  assert.equal(door.width, 0.9);
  const record = writeBuildingPlanRecord({ meta: f.meta, record: f.record, plan: after });
  assert.deepEqual(readBuildingPlanRecord({ meta: f.meta, record }), after);
});

test('a split vertex can make two diagonals and return to a compatible explicit Rejoin', () => {
  const f = fixture(),
    room = f.snapshot.floors[0].rooms[0];
  const cut = f.apply({ type: 'split_face', faceId: room.faces[0].id, offset: 2 }).created.id;
  const vertex = f.session
    .getSnapshot()
    .floors[0].rooms[0].vertices.find((v) => v.editingCutId === cut);
  f.apply({
    type: 'move_corner',
    roomId: room.id,
    vertexId: vertex.id,
    point: { x: vertex.x, y: -0.6 },
  });
  assert.deepEqual(f.session.validate(), []);
  f.apply({
    type: 'move_corner',
    roomId: room.id,
    vertexId: vertex.id,
    point: { x: vertex.x, y: 0 },
  });
  f.apply({ type: 'rejoin_cut', cutId: cut });
  assert.equal(f.session.getSnapshot().floors[0].rooms[0].vertices.length, 4);
});

test('child Cancel restores a corner and its shared neighbour while keeping earlier floor answers', () => {
  const f = fixture();
  f.session.beginScope({ id: 'floor' });
  f.session.apply(
    { type: 'set_defaults', floorId: f.floorId, property: 'wall_height_m', value: 3.4 },
    { scopeId: 'floor' }
  );
  const before = f.session.getSnapshot(),
    room = before.floors[0].rooms[1];
  f.session.beginScope({ id: 'room', parentScopeId: 'floor' });
  const result = f.session.apply(
    {
      type: 'move_corner',
      floorId: f.floorId,
      roomId: room.id,
      vertexId: room.vertices[0].id,
      point: { x: 3, y: 2.6 },
    },
    { scopeId: 'room' }
  );
  assert.equal(result.status, 'applied');
  assert.equal(f.session.cancelScope('room').status, 'cancelled');
  assert.deepEqual(f.session.getSnapshot(), before);
});
test('pins reject direct and propagated corner movement atomically', () => {
  const f = fixture(),
    before = f.session.getSnapshot(),
    room = before.floors[0].rooms[1];
  for (const pinnedFaceIds of [[room.faces[1].id], [before.floors[0].rooms[0].faces[2].id]]) {
    const vertex = room.vertices[pinnedFaceIds[0] === room.faces[1].id ? 2 : 0];
    const result = f.session.apply({
      type: 'move_corner',
      floorId: f.floorId,
      roomId: room.id,
      vertexId: vertex.id,
      point:
        pinnedFaceIds[0] === room.faces[1].id
          ? { x: vertex.x + 1, y: vertex.y }
          : { x: vertex.x, y: vertex.y - 0.4 },
      pinnedFaceIds,
    });
    assert.equal(result.status, 'conflict');
    assert.ok(
      result.issues.some((i) => i.code === 'pinned_wall_conflict'),
      JSON.stringify(result.issues)
    );
    assert.deepEqual(f.session.getSnapshot(), before);
  }
});
test('corner edits preserve explicit cuts in complex rooms and reject collapse', () => {
  const f = fixture();
  f.apply({ type: 'split_face', faceId: f.faceA, offset: 1.5 });
  f.apply({ type: 'resize_face', faceId: f.faceA, distance: 0.6 });
  const before = f.session.getSnapshot(),
    room = before.floors[0].rooms[1],
    corner = room.vertices.find((v) => v.x === 8 && v.y === 6.2);
  f.apply({
    type: 'move_corner',
    roomId: room.id,
    vertexId: corner.id,
    point: { x: corner.x + 0.7, y: corner.y },
  });
  assert.deepEqual(f.session.validate(), []);
  const after = f.session.getSnapshot();
  assert.deepEqual(
    after.floors[0].rooms.flatMap((r) =>
      r.vertices.filter((v) => v.editingCutId).map((v) => v.editingCutId)
    ),
    before.floors[0].rooms.flatMap((r) =>
      r.vertices.filter((v) => v.editingCutId).map((v) => v.editingCutId)
    )
  );
  const result = f.session.apply({
    type: 'move_corner',
    floorId: f.floorId,
    roomId: room.id,
    vertexId: corner.id,
    point: room.vertices[1],
  });
  assert.equal(result.status, 'conflict');
  assert.deepEqual(f.session.getSnapshot(), after);
});

for (const preserveWallGrouping of [false, true])
  for (const pin of [false, true])
    for (const targetY of [1.4, 2.8])
      test(`reshaping a jog's shared corner holds the stationary neighbour wall and can return (${pin ? 'pinned' : 'unpinned'}, grouped=${preserveWallGrouping}, y=${targetY})`, () => {
        const f = fixture({ preserveWallGrouping });
        f.apply({ type: 'resize_face', faceId: f.faceB, distance: 1 });
        const before = f.session.getSnapshot(),
          floor = before.floors[0],
          room = floor.rooms[1];
        const stationary = floor.rooms[0].faces.find((face) =>
          face.edgeIds.some((id) => {
            const edge = floor.rooms[0].edges.find((e) => e.id === id);
            return [edge.startId, edge.endId].every(
              (id) => floor.rooms[0].vertices.find((v) => v.id === id).y === 3
            );
          })
        );
        assert.ok(stationary);
        const endpointIds = floor.rooms[0].edges
          .filter((e) => stationary.edgeIds.includes(e.id))
          .flatMap((e) => [e.startId, e.endId]);
        const fixed = floor.rooms[0].vertices.filter((v) => endpointIds.includes(v.id));
        const pinnedFaceIds = pin ? [stationary.id] : [];
        f.apply({
          type: 'move_corner',
          roomId: room.id,
          vertexId: room.vertices[0].id,
          point: { x: 3, y: targetY },
          pinnedFaceIds,
        });
        const next = f.session.getSnapshot().floors[0];
        assert.deepEqual(
          next.rooms[0].vertices.filter((v) => endpointIds.includes(v.id)),
          fixed,
          'The unshared stationary wall must not tilt.'
        );
        assert.deepEqual(next.rooms[1].vertices.slice(1), room.vertices.slice(1));
        const east = floor.rooms[0].vertices.filter((v) => v.x === 5);
        for (const old of east)
          assert.equal(
            next.rooms[0].vertices.find((v) => v.id === old.id).x,
            5,
            'The stationary east wall must stay vertical.'
          );
        const moved = f.session.getSnapshot();
        const record = writeBuildingPlanRecord({ meta: f.meta, record: f.record, plan: moved });
        assert.deepEqual(readBuildingPlanRecord({ meta: f.meta, record }), moved);
        assert.deepEqual(moved.floors[0].observations, before.floors[0].observations);
        f.apply({
          type: 'move_corner',
          roomId: room.id,
          vertexId: room.vertices[0].id,
          point: { x: 3, y: 2.2 },
          pinnedFaceIds,
        });
        for (const [index, original] of floor.rooms.entries())
          assert.deepEqual(
            f.session.getSnapshot().floors[0].rooms[index].vertices,
            original.vertices
          );
        const returned = f.session.getSnapshot();
        f.session.undo();
        assert.deepEqual(f.session.getSnapshot(), moved);
        f.session.redo();
        assert.deepEqual(f.session.getSnapshot(), returned);
      });
