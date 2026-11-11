import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession, expandBuildingPlanSchema } from '../src/index.js';
import { createBuildingPlanSnapshot } from '../src/building-plan/model.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import { deriveBuildingPlanFloor } from '../src/building-plan/derive/index.js';
import { sameCapAnswers } from '../src/building-plan/derive/caps.js';
import { derivedSpecifications } from './helpers/building-plan-derive.js';

const round = (value) => Math.round(value * 1e4) / 1e4 + 0;
const edgesOf = (room) =>
  room.edges.map((edge) => {
    const [a, b] = [edge.startId, edge.endId].map((id) => room.vertices.find((v) => v.id === id));
    return { edge, a, b, length: Math.hypot(b.x - a.x, b.y - a.y) };
  });

test('a remainder inside a neighbour corner is a cap; a whole jog line stays a wall', () => {
  const example = createBuildingPlanExample();
  const session = createBuildingPlanSession({
    snapshot: example.snapshot,
    properties: example.meta.properties,
  });
  const result = session.apply({
    type: 'resize_face',
    floorId: example.floorId,
    faceId: example.faceA,
    distance: 0.2,
  });
  assert.equal(result.status, 'applied');
  const floor = session.getSnapshot().floors[0];
  const derived = deriveBuildingPlanFloor(floor, derivedSpecifications(example.meta));
  // Room B's moved line runs x 3..5.2 at y = 3.4: x 5..5.2 lies in A's corner material.
  const [roomA, roomB] = floor.rooms;
  assert.equal(derived.caps.length, 1);
  const [cap] = derived.caps;
  assert.equal(cap.roomId, roomB.id);
  assert.equal(round(cap.to - cap.from), 0.2);
  assert.ok(
    cap.source.lines.some((line) => line.roomId === roomA.id),
    'source: the shared wall'
  );
  // B's jog at x = 5.2 is a whole room line: a wall of its own, as today.
  const jog = derived.pieces.find(
    (piece) =>
      piece.line.roomId === roomB.id &&
      piece.exposure === 'exterior' &&
      round(piece.line.to - piece.line.from) === 0.2
  );
  assert.ok(jog && jog.subjectId, 'the jog keeps its stored wall');
});

test('the remainder of a wall inside an attached room wall becomes a cap of the shared wall', () => {
  const meta = expandBuildingPlanSchema({
    form: { elements: [{ type: 'BuildingPlanSection', key: 'plan', data_name: 'plan' }] },
  }).buildingPlanMeta[0];
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: createBuildingPlanSnapshot(),
    properties: meta.properties,
    createId: () => `id-${++serial}`,
    derivedCommands: true,
    editingPolicy: { inheritedChangePolicy: 'apply' },
  });
  const apply = (operation) => {
    const result = session.apply({ floorId, ...operation });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    assert.deepEqual(session.validate(), []);
    return result;
  };
  const floorId = session.apply({
    type: 'create_floor',
    values: { floor_exterior_wall_thickness: 0.5, floor_interior_wall_thickness: 0.2 },
  }).created.id;
  const roomA = apply({ type: 'create_room', rectangle: { x: 0, y: 0, width: 5, height: 3 } })
    .created.id;
  // Room C stands 0.2 m east of A from y = 0.3: A's east wall below it lies in C's south wall.
  apply({ type: 'create_room', rectangle: { x: 5.2, y: 0.3, width: 2.5, height: 2.7 } });
  const floor = session.getSnapshot().floors[0];
  const a = floor.rooms.find((room) => room.id === roomA);
  const stub = edgesOf(a).find(
    ({ a: p, b: q }) => p.x === 5 && q.x === 5 && round(Math.abs(q.y - p.y)) === 0.3
  );
  assert.ok(stub, 'A has a station where the contact starts');
  assert.ok(stub.edge.profile, 'the stub is a cap');
  const source = floor.walls.find((wall) => wall.id === stub.edge.profile.wallId);
  assert.equal(source.exposure, 'interior', 'its source is the shared wall');
  assert.ok(!a.faces.some((face) => face.edgeIds.includes(stub.edge.id)), 'no row of its own');
});

test('a stretch with answers of its own is never capped', () => {
  const plain = { values: {}, overrides: {}, sides: [] };
  const brick = { values: { material: 'Brick' }, overrides: {}, sides: [] };
  assert.equal(sameCapAnswers(plain, brick), true, 'no answers: nothing to lose');
  assert.equal(sameCapAnswers(brick, { ...brick }), true, 'copied answers: nothing to lose');
  assert.equal(sameCapAnswers(brick, plain), false);
  assert.equal(
    sameCapAnswers({ ...plain, repeatable: { layers: [{ id: 'r' }] } }, plain),
    false,
    'records keep a wall'
  );
});
