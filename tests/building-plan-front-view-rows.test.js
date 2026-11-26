import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildingPlanCanvasController, writeBuildingPlanRecord } from '../src/index.js';
import { buildingPlanFrontView } from '../src/building-plan/front-view.js';
import { newFreeWallFace, newFreeWallWidth } from '../src/building-plan/free-wall-lines.js';
import { applied, example } from './helpers/building-plan-bands.js';

// A3 (decided 2026-11-26): a room's entry steps Front through its Walls list's rows, free walls
// included, "W2 · 2 of 5", and a click on a wall's face on the mini-map shows it. Core gives the
// room's rows in the list's order with the front view (`rows`, from the canvas snapshot), and each
// row's face on the map (`map.rows`), as that row's own view shows it.

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

test("the controller lists the room's rows in its Walls list's order, free walls included", () => {
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
