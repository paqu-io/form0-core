import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildingPlanCanvasController } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import { buildingPlanFootprints } from '../src/building-plan/footprints.js';

// 4a-4 (2026-11-20): a free wall's split point bends it when dragged (a corner of the canvas
// snapshot, derived engine only), its runs' far centreline ends staying put; a moved Split
// portion's return stands centred on the split point whichever way it moves. The example's
// Bedroom is 0..5 × 0..3 m, its interior walls 20 cm thick.

function controllerFor(derivedCommands = true) {
  const f = createBuildingPlanExample();
  let record = f.record;
  const reported = [];
  const controller = new BuildingPlanCanvasController({
    meta: f.meta,
    readRecord: () => record,
    writeRecord: (next) => {
      record = next;
      return true;
    },
    reportIssues: (issues) => reported.splice(0, reported.length, ...issues),
    derivedCommands,
  });
  const g = controller.gridSize;
  const px = ([x, y]) => ({ x: x * g, y: y * g });
  const metres = (p) => [p.x / g, p.y / g].map((value) => Math.round(value * 1e3) / 1e3);
  const room = () => controller.session.getSnapshot().floors[0].rooms[0];
  const free = () => controller.getSnapshot().walls.filter((wall) => !wall.isBoundary);
  const bends = () => controller.getSnapshot().corners.filter((corner) => corner.freeWall);
  return { controller, g, px, metres, room, free, bends, reported };
}

async function splitWall(t, from, to, offset) {
  await t.controller.createWall(t.room().id, [t.px(from), t.px(to)]);
  await t.controller.splitWall(t.free()[0].id, { offset });
}

test('a split point is a corner that bends the wall; far centreline ends stay put', async () => {
  const t = controllerFor();
  await splitWall(t, [1, 1.5], [4, 1.5], 1.5);
  assert.deepEqual(
    t.bends().map((corner) => t.metres(corner.point)),
    [[2.5, 1.5]]
  );
  const corner = t.bends()[0];
  await t.controller.updateCorner(t.room().id, corner.id, t.px([2.5, 0.8]));
  const [earlier, later] = t.free();
  assert.deepEqual(t.metres(earlier.points[0]), [1, 1.5]);
  assert.deepEqual(t.metres(later.points.at(-1)), [4, 1.5]);
  assert.deepEqual(t.metres(t.bends()[0].point), [2.5, 0.8]);
  // Bent, it can't be rejoined.
  await t.controller.rejoinCut(t.controller.getSnapshot().editingCuts.find((c) => !c.automatic).id);
  assert.equal(t.reported[0]?.code, 'cut_not_aligned');
  t.controller.dispose();
});

test('a bend between two split points keeps the wall joined at the other one', async () => {
  const t = controllerFor();
  await splitWall(t, [1, 1.5], [4, 1.5], 1);
  // Split the right portion again at x 3.
  const right = t.free().find((wall) => t.metres(wall.points[0])[0] === 2);
  await t.controller.splitWall(right.id, { offset: 1 });
  const corner = t.bends().find((entry) => t.metres(entry.point)[0] === 3);
  await t.controller.updateCorner(t.room().id, corner.id, t.px([3, 1]));
  const faces = t.controller.session
    .getSnapshot()
    .floors[0].rooms[0].faces.filter((f) => f.freePath);
  // Every split point still joins two portions at one point.
  const ends = faces.flatMap((face) => [face.freePath[0], face.freePath.at(-1)]);
  for (const cut of ends.filter((point) => point.editingCutId)) {
    const same = ends.filter((point) => point.editingCutId === cut.editingCutId);
    assert.equal(same.length, 2);
    assert.ok(Math.hypot(same[0].x - same[1].x, same[0].y - same[1].y) < 1e-6);
  }
  t.controller.dispose();
});

test('a dragged bend point is held where both runs fit the room', async () => {
  const t = controllerFor();
  await splitWall(t, [1, 1.5], [4, 1.5], 1.5);
  const corner = t.bends()[0];
  const options = {
    roomId: t.room().id,
    vertexId: corner.id,
    originalPoint: corner.point,
    zoom: 10,
  };
  // Past the top face: it stops on it (both runs end there, cut along it).
  assert.deepEqual(
    t.metres(t.controller.interaction.snapCorner(t.px([2.5, -0.5]), options)),
    [2.5, 0]
  );
  t.controller.dispose();
});

test('no bend corners on today’s engine', async () => {
  const t = controllerFor(false);
  await splitWall(t, [1, 1.5], [4, 1.5], 1.5);
  assert.equal(t.bends().length, 0);
  t.controller.dispose();
});

test('a moved portion’s return is centred on the split point, up or down, and goes back', async () => {
  const t = controllerFor();
  await splitWall(t, [1, 1.5], [4, 1.5], 1.5);
  const returnBody = () => {
    const floor = t.controller.session.getSnapshot().floors[0];
    const wall = t.free().find((entry) => entry.isEditingReturn);
    const body = buildingPlanFootprints(floor, 1).wallFootprints.find(
      (entry) => entry.id === wall.physicalWallId
    );
    const xs = body.polygons.flat().map((point) => point.x);
    return [Math.min(...xs), Math.max(...xs)].map((value) => Math.round(value * 1e3) / 1e3);
  };
  const right = () =>
    t.free().find((wall) => !wall.isEditingReturn && t.metres(wall.points.at(-1))[0] === 4);
  const move = (dy) =>
    t.controller.updateWall(
      right().id,
      right().points.map((p) => ({ x: p.x, y: p.y + dy * t.g }))
    );
  await move(-0.5);
  assert.deepEqual(returnBody(), [2.4, 2.6]);
  // A canvas move a hair off square (its points rounded) still centres it.
  await t.controller.updateWall(
    right().id,
    right().points.map((p) => ({ x: p.x + 0.00005 * t.g, y: p.y - 0.1 * t.g }))
  );
  assert.deepEqual(returnBody(), [2.4, 2.6]);
  await move(0.1);
  await move(1);
  assert.deepEqual(returnBody(), [2.4, 2.6]);
  await move(-0.5);
  assert.equal(
    t.free().some((wall) => wall.isEditingReturn),
    false
  );
  assert.deepEqual(
    t.bends().map((corner) => t.metres(corner.point)),
    [[2.5, 1.5]]
  );
  t.controller.dispose();
});
