import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

const near = (a, b) => Math.abs(a - b) < 1e-9;

/**
 * The example (A and B sharing W3) with exterior walls `exterior` thick, prepared on today's
 * engine, then opened in a session on the derived core.
 */
function prepared(exterior = 0.5, setup = () => {}, editingPolicy = {}) {
  const f = createBuildingPlanExample();
  let serial = 0;
  const options = { properties: f.meta.properties, createId: () => `c-${++serial}` };
  const old = createBuildingPlanSession({ snapshot: f.snapshot, ...options });
  const run = (session, operation) => {
    const result = session.apply({ floorId: f.floorId, ...operation });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    assert.deepEqual(session.validate(), []);
    return result;
  };
  run(old, {
    type: 'set_provider',
    nodeKey: 'floors',
    fieldName: 'floor_exterior_wall_thickness',
    property: 'wall_thickness_m',
    value: exterior,
  });
  const ids = setup((operation) => run(old, operation)) || {};
  const session = createBuildingPlanSession({
    snapshot: old.getSnapshot(),
    ...options,
    derivedCommands: true,
    editingPolicy,
  });
  const floor = () => session.getSnapshot().floors[0];
  return { f, session, floor, ids, apply: (operation) => run(session, operation) };
}

const roomBy = (floor, id) => floor.rooms.find((room) => room.id === id);
const sharedWith = (floor, roomId) =>
  floor.walls.filter(
    (wall) =>
      wall.sides.filter((side) => side.roomId).length === 2 &&
      wall.sides.some((side) => side.roomId === roomId)
  );

test('R1: a dragged face lands at a new contact width; the neighbour keeps its face', () => {
  const t = prepared(0.5, (apply) => ({
    neighbour: apply({ type: 'create_room', rectangle: { x: 9, y: 3.2, width: 3, height: 3 } })
      .created.id,
  }));
  const before = roomBy(t.floor(), t.ids.neighbour).vertices;
  t.apply({ type: 'resize_face', faceId: 'acceptance-subject-50', distance: 0.5 });
  const floor = t.floor();
  assert.deepEqual(roomBy(floor, t.ids.neighbour).vertices, before);
  assert.ok(near(Math.max(...floor.rooms[1].vertices.map((v) => v.x)), 8.8));
  assert.deepEqual(
    sharedWith(floor, t.ids.neighbour).map((wall) => wall.properties.wall_thickness_m),
    [0.2]
  );
});

test('Keep previous values: the face lands at the wall current width, stored on the piece', () => {
  const t = prepared(0.5, (apply) => ({
    neighbour: apply({ type: 'create_room', rectangle: { x: 9, y: 3.2, width: 3, height: 3 } })
      .created.id,
  }));
  t.apply({
    type: 'resize_face',
    faceId: 'acceptance-subject-50',
    distance: 0.5,
    keepContactThickness: true,
  });
  const floor = t.floor();
  assert.ok(near(Math.max(...floor.rooms[1].vertices.map((v) => v.x)), 8.5));
  const [shared] = sharedWith(floor, t.ids.neighbour);
  assert.equal(shared.properties.wall_thickness_m, 0.5);
  assert.equal(shared.overrides.wall_thickness_m, 0.5);
});

test('R1: a jog placed against the other room lands at the contact width; that wall holds', () => {
  // A's face goes 0.8 m into B: B's jog first sits at A's 500 mm east wall, then faces it and
  // lands at the shared 200 mm width; A's east face and corner stay where they are.
  const t = prepared(0.5);
  t.apply({ type: 'resize_face', faceId: t.f.faceA, distance: 0.8 });
  const floor = t.floor();
  const [a, b] = floor.rooms;
  assert.ok(
    a.vertices.some((v) => near(v.x, 5) && near(v.y, 3.8)),
    'A reaches 3.8'
  );
  assert.ok(!a.vertices.some((v) => v.x > 5 + 1e-9), "A's east face holds");
  assert.ok(
    b.vertices.some((v) => near(v.x, 5.2) && near(v.y, 3.2)),
    "B's jog at 5.2"
  );
  // F2: the contact continues A's east wall.
  const contact = sharedWith(floor, b.id).find((wall) =>
    wall.sides.some((side) => side.roomId === a.id && wall.autoLabel.startsWith('W2'))
  );
  assert.ok(contact, 'the contact is a division of W2');
  assert.equal(contact.properties.wall_thickness_m, 0.2);
});

test('F3: a lengthened line meeting a wall at its current width keeps that width', () => {
  // Room C stands 0.5 m east of B, above B's top: B's east wall meets it once B grows upward.
  const t = prepared(0.5, (apply) => ({
    c: apply({ type: 'create_room', rectangle: { x: 8.5, y: 6.5, width: 3, height: 3 } }).created
      .id,
  }));
  const b = t.floor().rooms[1];
  const top = b.faces.find(
    (face) => t.floor().walls.find((w) => w.id === face.wallId).autoLabel === 'W7'
  );
  t.apply({ type: 'resize_face', faceId: top.id, distance: 1 });
  const floor = t.floor();
  const [shared] = sharedWith(floor, t.ids.c);
  assert.ok(shared, 'B and C share a wall');
  assert.equal(shared.properties.wall_thickness_m, 0.5);
  assert.equal(shared.overrides.wall_thickness_m, 0.5, 'the measured width is explicit');
  assert.ok(near(Math.max(...roomBy(floor, b.id).vertices.map((v) => v.x)), 8), 'B holds');
});

test('the "Keep previous values" answer prepares the face drag again at the current widths', () => {
  const t = prepared(
    0.5,
    (apply) => ({
      neighbour: apply({ type: 'create_room', rectangle: { x: 9, y: 3.2, width: 3, height: 3 } })
        .created.id,
    }),
    { inheritedChangePolicy: 'ask' }
  );
  const pending = t.session.apply({
    floorId: t.f.floorId,
    type: 'resize_face',
    faceId: 'acceptance-subject-50',
    distance: 0.5,
  });
  assert.equal(pending.status, 'pending');
  const result = t.session.resolveUIRequest(pending.uiOperations[0].params.requestId, {
    value: 'preserve',
  });
  assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  const floor = t.floor();
  assert.ok(near(Math.max(...floor.rooms[1].vertices.map((v) => v.x)), 8.5));
  assert.equal(sharedWith(floor, t.ids.neighbour)[0].properties.wall_thickness_m, 0.5);
});

for (const distance of [2.9, 3, 3.1, 3.2])
  test(`R1: an exterior portion returns across an interior-500 junction (${distance})`, () => {
    // Interior 0.5, exterior 0.2: B's W3.1 face goes down beside A's east wall. A holds; B's jog
    // lands 0.5 m from it (the shared width), and the face returns to its line.
    const t = prepared(0.2, (apply) => {
      apply({
        type: 'set_provider',
        nodeKey: 'floors',
        fieldName: 'floor_interior_wall_thickness',
        property: 'wall_thickness_m',
        value: 0.5,
      });
    });
    const start = t.floor();
    const [a, b] = start.rooms;
    const face = b.faces.find(
      (entry) => start.walls.find((wall) => wall.id === entry.wallId).autoLabel === 'W3.1'
    );
    const corner = a.vertices.find((v) => near(v.x, 5) && near(v.y, 3)).id;
    t.apply({ type: 'resize_face', faceId: face.id, distance });
    const moved = t.floor();
    assert.ok(near(roomBy(moved, a.id).vertices.find((v) => v.id === corner).x, 5), 'A holds');
    assert.ok(
      roomBy(moved, b.id).vertices.some((v) => near(v.x, 5.5)),
      "B's jog at 5.5"
    );
    t.apply({ type: 'resize_face', faceId: face.id, distance: -distance });
    const back = roomBy(t.floor(), b.id);
    assert.ok(
      back.vertices.some((v) => near(v.x, 8) && near(v.y, 3.2)),
      'the face returns'
    );
    for (const previous of start.rooms)
      for (const point of previous.vertices.filter((v) => v.x === 0 || v.y === 6.2))
        assert.deepEqual(
          roomBy(t.floor(), previous.id).vertices.find((v) => v.id === point.id),
          point
        );
  });
