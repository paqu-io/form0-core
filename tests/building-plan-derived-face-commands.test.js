import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession, expandBuildingPlanSchema } from '../src/index.js';
import { createBuildingPlanSnapshot } from '../src/building-plan/model.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

const round = (value) => Math.round(value * 1e4) / 1e4 + 0;

/** The example (rooms A and B sharing W3) in a session on the derived core. */
function example({ materials = false } = {}) {
  const f = createBuildingPlanExample();
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    createId: () => `t-${++serial}`,
    derivedCommands: true,
  });
  const floor = () => session.getSnapshot().floors[0];
  const apply = (operation) => {
    const result = session.apply({ floorId: f.floorId, ...operation });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    assert.deepEqual(session.validate(), []);
    return result;
  };
  if (materials)
    for (const wall of floor().walls)
      apply({
        type: 'set_property',
        wallId: wall.id,
        property: 'material',
        value: `M-${wall.autoLabel}`,
      });
  return { f, session, floor, apply };
}

/** Room outline as [x, y] corners, with the label (or cap source) of each edge. */
function outline(floor, room) {
  const v = (id) => room.vertices.find((p) => p.id === id);
  return room.edges.map((edge) => {
    const face = room.faces.find((entry) => entry.edgeIds.includes(edge.id));
    const wall = face && floor.walls.find((entry) => entry.id === face.wallId);
    const cap = edge.profile && floor.walls.find((entry) => entry.id === edge.profile.wallId);
    const a = v(edge.startId);
    return [[round(a.x), round(a.y)], wall ? wall.autoLabel : `cap:${cap?.autoLabel}`];
  });
}
const wallBy = (floor, label) => floor.walls.find((wall) => wall.autoLabel === label);

test('a shared face drag moves the wall; jogs copy the adjacent part with their exposure (F1)', () => {
  const t = example({ materials: true });
  t.apply({ type: 'resize_face', faceId: t.f.faceA, distance: 0.2 });
  const floor = t.floor();
  const [a, b] = floor.rooms;
  assert.deepEqual(outline(floor, a), [
    [[0, 0], 'W1'],
    [[5, 0], 'W2'],
    [[5, 3.2], 'W3'],
    [[3, 3.2], 'W3.4'],
    [[3, 3], 'W3.2'],
    [[0, 3], 'W4'],
  ]);
  assert.deepEqual(outline(floor, b), [
    [[3, 3.4], 'W3'],
    [[5, 3.4], 'cap:W3'],
    [[5.2, 3.4], 'W3.3'],
    [[5.2, 3.2], 'W3.1'],
    [[8, 3.2], 'W6'],
    [[8, 6.2], 'W7'],
    [[3, 6.2], 'W8'],
  ]);
  // A's exterior jog continues A's exterior wall, not the shared partition; B's jog B's W3.1.
  assert.equal(wallBy(floor, 'W3.4').properties.material, 'M-W3.2');
  assert.equal(wallBy(floor, 'W3.3').properties.material, 'M-W3.1');
});

test('dragging back restores the walls; a negative drag steps around the neighbour corner', () => {
  const t = example();
  const before = t.floor();
  t.apply({ type: 'resize_face', faceId: t.f.faceA, distance: 0.2 });
  t.apply({ type: 'resize_face', faceId: t.f.faceA, distance: -0.2 });
  const back = t.floor();
  for (const room of back.rooms)
    assert.deepEqual(
      outline(back, room),
      outline(
        before,
        before.rooms.find((entry) => entry.id === room.id)
      )
    );
  assert.deepEqual(
    back.walls.map((wall) => wall.autoLabel),
    before.walls.map((wall) => wall.autoLabel)
  );

  const u = example();
  u.apply({ type: 'resize_face', faceId: u.f.faceA, distance: -0.2 });
  const [a, b] = u.floor().rooms;
  // Today's result: A steps around B's west corner, B's jog sits at A's east wall.
  assert.deepEqual(
    outline(u.floor(), a).map(([point]) => point),
    [
      [0, 0],
      [5, 0],
      [5, 2.8],
      [3, 2.8],
      [2.8, 2.8],
      [2.8, 3],
      [0, 3],
    ]
  );
  assert.deepEqual(
    outline(u.floor(), b)
      .map(([point]) => point)
      .slice(0, 3),
    [
      [3, 3],
      [5, 3],
      [5, 3.2],
    ]
  );
});

test('a jog against an existing wall continues that wall over the contact (F2)', () => {
  const t = example({ materials: true });
  t.apply({ type: 'resize_face', faceId: t.f.faceB, distance: 0.3 });
  const floor = t.floor();
  const a = floor.rooms[0];
  // A's jog at x = 2.8 faces B's lengthened west wall W8 over 2.9..3.
  const contact = outline(floor, a).find(([[x, y]]) => x === 2.8 && y === 2.9);
  const wall = wallBy(floor, contact[1]);
  assert.equal(wall.exposure, 'interior');
  assert.equal(wall.properties.material, 'M-W8');
});

test('a partial drag of an exterior wall makes two jogs; the drawn part keeps its row', () => {
  const meta = expandBuildingPlanSchema({
    form: { elements: [{ type: 'BuildingPlanSection', key: 'plan', data_name: 'plan' }] },
  }).buildingPlanMeta[0];
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: createBuildingPlanSnapshot(),
    properties: meta.properties,
    createId: () => `id-${++serial}`,
    derivedCommands: true,
  });
  const floorId = session.apply({ type: 'create_floor', values: {} }).created.id;
  session.apply({ type: 'create_room', floorId, rectangle: { x: 0, y: 0, width: 10, height: 4 } });
  const room = () => session.getSnapshot().floors[0].rooms[0];
  const top = room().faces.find((face) => {
    const edge = room().edges.find((entry) => entry.id === face.edgeIds[0]);
    const ends = [edge.startId, edge.endId].map((id) => room().vertices.find((v) => v.id === id));
    return ends.every((p) => p.y === 4);
  });
  const result = session.apply({
    type: 'resize_face',
    floorId,
    faceId: top.id,
    distance: 0.5,
    interval: [4, 7],
  });
  assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  assert.deepEqual(session.validate(), []);
  const corners = room().vertices.map((p) => [round(p.x), round(p.y)]);
  assert.deepEqual(corners, [
    [0, 0],
    [10, 0],
    [10, 4],
    [6, 4],
    [6, 4.5],
    [3, 4.5],
    [3, 4],
    [0, 4],
  ]);
  assert.ok(
    room().faces.some((face) => face.id === top.id),
    'the dragged row stays'
  );
  const floor = session.getSnapshot().floors[0];
  assert.equal(floor.walls.length, 8, 'two parts of the old wall and two jogs');
  session.undo();
  assert.equal(session.getSnapshot().floors[0].rooms[0].vertices.length, 4, 'Undo restores');
});

test('refusals: an extent outside the edge, a non-finite distance, an inverted room', () => {
  const t = example();
  const refused = (operation, code) => {
    const result = t.session.apply({ floorId: t.f.floorId, type: 'resize_face', ...operation });
    assert.notEqual(result.status, 'applied');
    assert.equal(result.issues[0].code, code);
  };
  refused({ faceId: t.f.faceA, distance: 0.2, interval: [-1, 1] }, 'invalid_dimension');
  refused({ faceId: t.f.faceA, distance: Number.NaN }, 'invalid_dimension');
  refused({ faceId: t.f.faceA, distance: -4 }, 'invalid_room_geometry');
});
