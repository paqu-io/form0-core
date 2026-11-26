import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildingPlanCanvasController, writeBuildingPlanRecord } from '../src/index.js';
import { buildingPlanFrontView } from '../src/building-plan/front-view.js';
import { newFreeWallFace, newFreeWallWidth } from '../src/building-plan/free-wall-lines.js';
import { applied, example } from './helpers/building-plan-bands.js';

// A3 (decided 2026-11-26): a room's entry steps Front through its walls, "W2 · 2 of 5", and a
// click on a wall's face on the mini-map shows it. Core gives the room's rows with the front view
// (`rows`, with the canvas snapshot's elements) and each row's face on the map (`map.rows`), as
// that row's own view shows it. The order (asked in A3's hand test, 2026-11-26): around the room,
// clockwise on the plan, from the Walls list's first wall, each outline row where it starts; free
// walls after, in the list's order. The list itself keeps the order rows were made in.

const p = (x, y) => ({ x, y });
function withFreeWall() {
  const t = example();
  const room = t.floor().rooms[0];
  applied(
    t.apply({
      type: 'create_wall',
      roomId: room.id,
      vertices: newFreeWallFace(
        [p(1, 1.5), p(3, 1.5)],
        newFreeWallWidth(t.floor(), room.id, t.f.meta.properties)
      ),
      values: {},
    })
  );
  return t;
}

test("every row's face on the map, as that row's own view shows it", () => {
  const t = withFreeWall();
  const floor = t.floor();
  const room = floor.rooms[0];
  const w1 = room.faces.find((face) => face.wallId === t.wall('W1').id);
  const { map } = buildingPlanFrontView(floor, w1.id);
  assert.deepEqual(
    map.rows.map((row) => row.faceId),
    room.faces.map((face) => face.id)
  );
  const w2 = room.faces.find((face) => face.wallId === t.wall('W2').id);
  // W2 seen from inside, facing east: from its top end down.
  assert.deepEqual(map.rows.find((row) => row.faceId === w2.id).segments, [[p(5, 0), p(5, 3)]]);
  for (const row of map.rows)
    assert.deepEqual(row.segments, buildingPlanFrontView(floor, row.faceId).map.shown, row.faceId);
});

test("the controller lists the room's rows around it, free walls last", () => {
  const t = withFreeWall();
  let record = writeBuildingPlanRecord({ meta: t.f.meta, plan: t.session.getSnapshot() });
  const controller = new BuildingPlanCanvasController({
    meta: t.f.meta,
    derivedCommands: true,
    readRecord: () => record,
    writeRecord: (next) => ((record = next), true),
  });
  const floor = controller.session.getSnapshot().floors[0];
  const [bedroom, other] = floor.rooms;
  const free = bedroom.faces.find((face) => face.freePath);
  const freeLabel = floor.walls.find((wall) => wall.id === free.wallId).autoLabel;
  const v = controller.frontView(bedroom.faces[0].id);
  assert.deepEqual(
    v.rows.map((row) => row.label),
    ['W1', 'W2', 'W3', 'W3.2', 'W4', freeLabel]
  );
  const snapshot = controller.getSnapshot();
  for (const row of v.rows) {
    const entry = snapshot.walls.find((wall) => wall.id === row.faceId);
    assert.equal(entry.roomId, bedroom.id);
    assert.deepEqual(row.ref, { collection: 'walls', id: entry.id, path: entry.path });
  }
  assert.deepEqual(
    v.rows.map((row) => row.ref.path.at(-1).index),
    [0, 1, 2, 3, 4, 5]
  );
  // The same list from any of its rows; Room 2's its own.
  assert.deepEqual(controller.frontView(free.id).rows, v.rows);
  assert.deepEqual(
    controller.frontView(other.faces[0].id).rows.map((row) => row.label),
    ['W3', 'W3.1', 'W6', 'W7', 'W8']
  );
  controller.dispose();
});

const POLICY = {
  inheritedChangePolicy: 'apply',
  thicknessAnchor: 'room_face',
  sharedWallDrag: 'widen',
};
function controllerOf(t) {
  let record = writeBuildingPlanRecord({ meta: t.f.meta, plan: t.session.getSnapshot() });
  return new BuildingPlanCanvasController({
    meta: t.f.meta,
    derivedCommands: true,
    readRecord: () => record,
    writeRecord: (next) => ((record = next), true),
  });
}

test("a jog's new row is stepped where it stands, not where the list put it", () => {
  const t = example(POLICY);
  const face = t.floor().rooms[0].faces.find((entry) => entry.wallId === t.wall('W3.2').id);
  applied(t.apply({ type: 'resize_face', faceId: face.id, distance: 0.752 }));
  const controller = controllerOf(t);
  const room = controller.session.getSnapshot().floors[0].rooms[0];
  const rows = controller.frontView(room.faces[0].id).rows;
  // The list: W1 W2 W3 W3.2 W4 W8.1 (the drag's leftover made last); around: W8.1 after W3.
  assert.deepEqual(
    rows.map((row) => row.label),
    ['W1', 'W2', 'W3', 'W8.1', 'W3.2', 'W4']
  );
  assert.deepEqual(
    rows.map((row) => row.ref.path.at(-1).index),
    [0, 1, 2, 5, 3, 4]
  );
  controller.dispose();
});

test('a room drawn the other way round still steps clockwise on the plan', () => {
  const t = example();
  // Down its left side first: counter-clockwise on the plan (y down).
  applied(
    t.apply({
      type: 'create_room',
      attach: false,
      vertices: [p(10, 0), p(10, 3), p(14, 3), p(14, 0)],
    })
  );
  const controller = controllerOf(t);
  const room = controller.session.getSnapshot().floors[0].rooms.at(-1);
  const rows = controller.frontView(room.faces[0].id).rows;
  const sideOf = (row) => {
    const v = controller.frontView(row.faceId).map.shown[0];
    const [a, b] = v;
    if (a.x === b.x) return a.x === 10 ? 'left' : 'right';
    return a.y === 0 ? 'top' : 'bottom';
  };
  // From the list's first wall, its left side, then the top, the right, the bottom.
  assert.equal(rows[0].ref.path.at(-1).index, 0);
  assert.deepEqual(rows.map(sideOf), ['left', 'top', 'right', 'bottom']);
  controller.dispose();
});
