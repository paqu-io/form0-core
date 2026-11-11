import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession, expandBuildingPlanSchema } from '../src/index.js';
import { createBuildingPlanSnapshot } from '../src/building-plan/model.js';
import { roomBounds } from '../src/building-plan/geometry.js';

const meta = expandBuildingPlanSchema({
  form: { elements: [{ type: 'BuildingPlanSection', key: 'plan', data_name: 'plan' }] },
}).buildingPlanMeta[0];
const near = (a, b) => Math.abs(a - b) < 1e-6;

/** A session on the derived core with one floor (all walls 0.2). */
function fixture() {
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: createBuildingPlanSnapshot(),
    properties: meta.properties,
    createId: () => `rr-${++serial}`,
    derivedCommands: true,
  });
  const floorId = session.apply({ type: 'create_floor', values: {} }).created.id;
  const apply = (operation) => {
    const result = session.apply({ floorId, ...operation });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    assert.deepEqual(session.validate(), []);
    return result;
  };
  const room = (rectangle) => apply({ type: 'create_room', rectangle }).created.id;
  const floor = () => session.getSnapshot().floors[0];
  const byId = (id) => floor().rooms.find((entry) => entry.id === id);
  return { session, floorId, apply, room, floor, byId };
}
/** The row on a room's side at x (or y) = value. */
const faceAt = (room, axis, value) =>
  room.faces.find((face) =>
    face.edgeIds.some((id) => {
      const edge = room.edges.find((entry) => entry.id === id);
      return [edge.startId, edge.endId]
        .map((v) => room.vertices.find((p) => p.id === v))
        .every((p) => near(p[axis], value));
    })
  );

test('resize_room scales a room that shares no wall; its door keeps its place in proportion', () => {
  const t = fixture();
  const id = t.room({ x: 0, y: 0, width: 4, height: 3 });
  const wall = t.floor().walls[0];
  t.apply({
    type: 'create_opening',
    wallId: wall.id,
    kind: 'door',
    offset: 1,
    width: 0.9,
    height: 2,
  });
  t.apply({ type: 'resize_room', roomId: id, rectangle: { x: 0, y: 0, width: 8, height: 3 } });
  const bounds = roomBounds(t.byId(id));
  assert.deepEqual([bounds.x, bounds.y, bounds.width, bounds.height], [0, 0, 8, 3]);
  const door = t.floor().walls.find((entry) => entry.id === wall.id).doors[0];
  assert.ok(near(door.width, 0.9));
  assert.ok(near(door.offset + door.width / 2, 2 * (1 + 0.45)), 'its centre scales with the wall');
});

test('resize_room moves the sides of a room sharing walls as face drags; the neighbour follows', () => {
  const t = fixture();
  const a = t.room({ x: 0, y: 0, width: 5, height: 3 });
  const b = t.room({ x: 5.2, y: 0, width: 4, height: 3 });
  t.apply({ type: 'resize_room', roomId: a, rectangle: { x: 0, y: 0, width: 5.5, height: 3.5 } });
  const [boundsA, boundsB] = [a, b].map((id) => roomBounds(t.byId(id)));
  assert.ok(near(boundsA.width, 5.5) && near(boundsA.height, 3.5));
  assert.ok(near(boundsB.x, 5.7), 'B follows the shared wall');
  assert.ok(near(boundsB.width, 3.5));
});

test('bounded size preservation propagates only through the supplied room group', () => {
  const t = fixture();
  const a = t.room({ x: 0, y: 0, width: 5, height: 3 });
  const b = t.room({ x: 5.2, y: 0, width: 4, height: 3 });
  const c = t.room({ x: 9.4, y: 0, width: 4, height: 3 });
  const faceA = faceAt(t.byId(a), 'x', 5).id;
  const before = t.session.getSnapshot();
  const operation = {
    type: 'resize_preserve_group',
    floorId: t.floorId,
    faceId: faceA,
    distance: 0.5,
    affectedRoomIds: [a, b],
    preserveRoomIds: [b],
  };
  const denied = t.session.apply(operation);
  assert.equal(denied.status, 'conflict');
  assert.equal(denied.issues[0].code, 'outside_affected_group');
  assert.deepEqual(t.session.getSnapshot(), before);
  t.apply({ ...operation, affectedRoomIds: [a, b, c], preserveRoomIds: [b, c] });
  assert.ok(near(roomBounds(t.byId(b)).width, 4));
  assert.ok(near(roomBounds(t.byId(c)).width, 4));
  assert.ok(near(roomBounds(t.byId(c)).x, 9.9));
  assert.equal(t.session.undo().status, 'undone');
  assert.deepEqual(t.session.getSnapshot(), before);
  const missing = t.session.apply({ ...operation, affectedRoomIds: [] });
  assert.equal(missing.issues[0].code, 'affected_group_required');
});
