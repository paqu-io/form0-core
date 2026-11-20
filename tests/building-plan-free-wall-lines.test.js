import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildingPlanCanvasController, placeBuildingPlanColumn } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import { freeWallSideDistance, offsetLine } from '../src/building-plan/free-wall-lines.js';

// 4a-3 (2026-11-20): free walls are drawn, moved and checked by their centreline. The record keeps
// the face each was drawn along (the row's side), with the body beside it; the canvas snapshot
// gives a free wall's centreline (`points`) and its row's face (`sidePoints`), and the controller
// turns a centreline back into that face. The example's interior walls are 20 cm thick.

function controllerFor(derivedCommands = true) {
  const f = createBuildingPlanExample();
  let record = f.record;
  const controller = new BuildingPlanCanvasController({
    meta: f.meta,
    readRecord: () => record,
    writeRecord: (next) => {
      record = next;
      return true;
    },
    derivedCommands,
  });
  const g = controller.gridSize;
  const floor = () => controller.session.getSnapshot().floors[0];
  const room = () => floor().rooms[0];
  const px = (points) => points.map(([x, y]) => ({ x: x * g, y: y * g }));
  const metres = (points) =>
    points.map(({ x, y }) => [x, y].map((value) => Math.round((value / g) * 1e6) / 1e6));
  const freeWall = () => controller.getSnapshot().walls.find((wall) => !wall.isBoundary);
  return { f, controller, g, floor, room, px, metres, freeWall };
}
const round = (points) =>
  points.map(({ x, y }) => [x, y].map((value) => Math.round(value * 1e6) / 1e6));

test('a free wall drawn by its centreline: the canvas gets it back, the row keeps its face', async () => {
  for (const derived of [true, false]) {
    const t = controllerFor(derived);
    await t.controller.createWall(
      t.room().id,
      t.px([
        [3, 1],
        [5, 1],
      ])
    );
    const wall = t.freeWall();
    assert.deepEqual(t.metres(wall.points), [
      [3, 1],
      [5, 1],
    ]);
    assert.deepEqual(t.metres(wall.axisPoints), t.metres(wall.points));
    // The face it lies along, half its width to the centreline's left; stored as before.
    assert.deepEqual(t.metres(wall.sidePoints), [
      [3, 1.1],
      [5, 1.1],
    ]);
    const face = t.room().faces.find((entry) => entry.freePath);
    assert.deepEqual(round(face.freePath), [
      [3, 1.1],
      [5, 1.1],
    ]);
    // Room walls are given by their face, as before.
    const roomWall = t.controller.getSnapshot().walls.find((entry) => entry.isBoundary);
    assert.equal(roomWall.sidePoints, undefined);
    t.controller.dispose();
  }
});

test('moved or turned by its centreline, a free wall keeps its side and its distance', async () => {
  const t = controllerFor();
  await t.controller.createWall(
    t.room().id,
    t.px([
      [3, 1],
      [5, 1],
    ])
  );
  const id = t.freeWall().id;
  await t.controller.updateWall(
    id,
    t.px([
      [2, 1],
      [3, 2],
    ])
  );
  const wall = t.freeWall();
  assert.deepEqual(t.metres(wall.points), [
    [2, 1],
    [3, 2],
  ]);
  assert.ok(Math.abs(freeWallSideDistance(wall.points, wall.sidePoints) - 0.1 * t.g) < 1e-6);
  t.controller.dispose();
});

test('a thicker free wall keeps its centreline (the canvas policy anchors room faces)', async () => {
  const t = controllerFor();
  await t.controller.createWall(
    t.room().id,
    t.px([
      [3, 1],
      [5, 1],
    ])
  );
  const face = t.room().faces.find((entry) => entry.freePath);
  const result = t.controller.session.apply({
    floorId: t.f.floorId,
    type: 'set_property',
    wallId: face.wallId,
    property: 'wall_thickness',
    value: 0.3,
    activeRoomId: t.room().id,
  });
  assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  t.controller.refresh();
  const wall = t.freeWall();
  assert.deepEqual(t.metres(wall.points), [
    [3, 1],
    [5, 1],
  ]);
  assert.deepEqual(t.metres(wall.sidePoints), [
    [3, 1.15],
    [5, 1.15],
  ]);
  t.controller.dispose();
});

test('a Split mark on a free wall shows on its centreline', async () => {
  const t = controllerFor();
  await t.controller.createWall(
    t.room().id,
    t.px([
      [1, 2],
      [3, 2],
    ])
  );
  const result = await t.controller.splitWall(t.freeWall().id, { offset: 1 });
  assert.notEqual(result?.status, 'conflict', JSON.stringify(result?.issues));
  const marks = t.controller.getSnapshot().editingCuts.filter((cut) => !cut.automatic);
  assert.deepEqual(
    marks.map((cut) => t.metres([cut.point])[0]),
    [[2, 2]]
  );
  t.controller.dispose();
});

test('"Add column" at a mark on a free wall’s centreline: flush against its row’s side', async () => {
  const t = controllerFor();
  await t.controller.createWall(
    t.room().id,
    t.px([
      [1, 1.5],
      [4, 1.5],
    ])
  );
  // The row's face at y 1.6, the body from 1.4 to 1.6: a 30 cm column flush on the face's side.
  const centre = placeBuildingPlanColumn(
    { ...t.controller.getSnapshot(), gridSize: t.g },
    {
      roomId: t.room().id,
      wallId: t.freeWall().id,
      mark: { x: 2.5 * t.g, y: 1.5 * t.g },
      width: 0.3,
      height: 0.3,
      // Close in, so nothing lines it up with Bedroom's corner at x 3.
      zoom: 10,
    }
  );
  assert.deepEqual(t.metres([centre]), [[2.5, 1.75]]);
  t.controller.dispose();
});

test('offsetLine moves a line along its normal, joints where the moved lines cross', () => {
  assert.deepEqual(
    round(
      offsetLine(
        [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
        ],
        0.1
      )
    ),
    [
      [0, 0.1],
      [2, 0.1],
    ]
  );
  assert.deepEqual(
    round(
      offsetLine(
        [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 2 },
        ],
        -0.1
      )
    ),
    [
      [0, -0.1],
      [2.1, -0.1],
      [2.1, 2],
    ]
  );
});
