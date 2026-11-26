import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildingPlanCanvasController, writeBuildingPlanRecord } from '../src/index.js';
import { buildingPlanFrontView } from '../src/building-plan/front-view.js';
import { newFreeWallFace, newFreeWallWidth } from '../src/building-plan/free-wall-lines.js';
import { applied, example } from './helpers/building-plan-bands.js';

// Free walls in Front (asked in A3's hand test, 2026-11-26): a free wall of the room whose body
// touches the shown side's face (meeting it, or set into it) is drawn there, as columns are: from
// the floor to its height (unknown: its wall's drawn height), by its stretch along the side and
// the row it stands against, `endOn` when it meets the wall across. One standing free isn't.

const p = (x, y) => ({ x, y });
/** Adds a free wall to the Bedroom along `from`..`to`; its row. */
function withFreeWall(t, from, to) {
  const room = t.floor().rooms[0];
  const before = new Set(room.faces.map((face) => face.id));
  applied(
    t.apply({
      type: 'create_wall',
      roomId: room.id,
      vertices: newFreeWallFace(
        [from, to],
        newFreeWallWidth(t.floor(), room.id, t.f.meta.properties)
      ),
      values: {},
    })
  );
  return t.floor().rooms[0].faces.find((face) => face.freePath && !before.has(face.id));
}
const faceOf = (t, label) =>
  t.floor().rooms[0].faces.find((face) => face.wallId === t.wall(label).id).id;
const view = (t, label) => buildingPlanFrontView(t.floor(), faceOf(t, label));
const walls = (v) => v.freeWalls.map((w) => [w.name, w.from, w.to, w.bottom, w.top, w.endOn]);

test('a free wall meeting W1 is drawn in W1’s Front, end on; not in W3’s', () => {
  const t = example();
  const free = withFreeWall(t, p(1, 0), p(1, 1.5));
  const label = t.floor().walls.find((wall) => wall.id === free.wallId).autoLabel;
  const w1 = view(t, 'W1');
  // Its body is x 0.9..1.1 from W1's face; W1 seen from inside runs from x 0.
  assert.deepEqual(walls(w1), [[label, 0.9, 1.1, 0, 3, true]]);
  assert.equal(w1.freeWalls[0].rowId, free.id);
  assert.equal(w1.freeWalls[0].faceId, faceOf(t, 'W1'));
  assert.equal(w1.freeWalls[0].height, 3);
  assert.deepEqual(view(t, 'W3').freeWalls, []);
  // A free wall standing free in the room: in no wall's Front.
  withFreeWall(t, p(2.5, 1), p(4, 1));
  assert.deepEqual(walls(view(t, 'W1')), [[label, 0.9, 1.1, 0, 3, true]]);
  for (const other of ['W2', 'W3', 'W3.2', 'W4']) assert.deepEqual(view(t, other).freeWalls, []);
});

test('a free wall of unknown height is drawn to its wall’s drawn height; its canvas element', () => {
  const t = example();
  const free = withFreeWall(t, p(1, 0), p(1, 1.5));
  applied(t.floorValues({ floor_height: null }));
  const [wall] = view(t, 'W1').freeWalls;
  assert.equal(wall.height, null);
  assert.equal(wall.top, view(t, 'W1').pieces[0].drawnHeight);
  let record = writeBuildingPlanRecord({ meta: t.f.meta, plan: t.session.getSnapshot() });
  const controller = new BuildingPlanCanvasController({
    meta: t.f.meta,
    derivedCommands: true,
    readRecord: () => record,
    writeRecord: (next) => ((record = next), true),
  });
  const v = controller.frontView(faceOf(t, 'W1'));
  const entry = controller.getSnapshot().walls.find((item) => item.id === free.id);
  assert.deepEqual(v.freeWalls[0].ref, { collection: 'walls', id: free.id, path: entry.path });
  controller.dispose();
});
