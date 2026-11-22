import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildingPlanCanvasController } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

// Moving a free wall's return (hand test 2026-11-22: "Move an adjacent partition portion to adjust
// this return." when W9.2 was dragged). A return moves parallel to itself, its ends sliding along
// the portions it joins, which lengthen or shorten and keep their direction. The example's
// Bedroom is 0..5 × 0..3 m.

function controllerFor() {
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
    derivedCommands: true,
  });
  const g = controller.gridSize;
  const px = ([x, y]) => ({ x: x * g, y: y * g });
  const metres = (p) => [p.x / g, p.y / g].map((value) => Math.round(value * 1e4) / 1e4 + 0);
  const room = () => controller.session.getSnapshot().floors[0].rooms[0];
  const free = () => controller.getSnapshot().walls.filter((wall) => !wall.isBoundary);
  const parts = () => {
    const walls = free();
    const back = walls.find((wall) => wall.isEditingReturn);
    const others = walls
      .filter((wall) => wall !== back)
      .sort((a, b) => a.points[0].x - b.points[0].x);
    return { earlier: others[0], later: others[1], back };
  };
  const shift = (wall, [dx, dy]) => wall.points.map((p) => ({ x: p.x + dx * g, y: p.y + dy * g }));
  return { controller, g, px, metres, room, free, parts, shift, reported };
}

/** A wall from 1 to 4 m at y 1.5, split at 2.5 m, its later portion moved 0.5 m down. */
async function withReturn(t) {
  await t.controller.createWall(t.room().id, [t.px([1, 1.5]), t.px([4, 1.5])]);
  await t.controller.splitWall(t.free()[0].id, { offset: 1.5 });
  const later = t.free().sort((a, b) => b.points[0].x - a.points[0].x)[0];
  assert.ok(await t.controller.updateWall(later.id, t.shift(later, [0, 0.5])));
  assert.ok(t.parts().back, 'the move made a return');
}

test('a return moves parallel to itself; the portions it joins lengthen and shorten', async () => {
  const t = controllerFor();
  await withReturn(t);
  const before = t.parts();
  assert.ok(await t.controller.updateWall(before.back.id, t.shift(before.back, [0.3, 0])));
  assert.deepEqual(t.reported, []);
  const after = t.parts();
  const moved = (wall, index) => t.metres(wall.points.at(index));
  const plus = (point, dx) => [point[0] + dx, point[1]].map((v) => Math.round(v * 1e4) / 1e4);
  assert.deepEqual(moved(after.earlier, -1), plus(moved(before.earlier, -1), 0.3));
  assert.deepEqual(moved(after.later, 0), plus(moved(before.later, 0), 0.3));
  assert.deepEqual(t.metres(after.earlier.points[0]), t.metres(before.earlier.points[0]));
  assert.deepEqual(t.metres(after.later.points.at(-1)), t.metres(before.later.points.at(-1)));
  assert.deepEqual(
    after.back.points.map(t.metres),
    before.back.points.map((p) => plus(t.metres(p), 0.3))
  );
  t.controller.dispose();
});

test('beside slanted portions, its ends stay on their lines', async () => {
  // As at the hand test: the split point bent first, then the later portion moved square to itself.
  const t = controllerFor();
  await t.controller.createWall(t.room().id, [t.px([1, 1.5]), t.px([4, 1.5])]);
  await t.controller.splitWall(t.free()[0].id, { offset: 1.5 });
  const bend = t.controller.getSnapshot().corners.find((corner) => corner.freeWall);
  await t.controller.updateCorner(t.room().id, bend.id, t.px([2.5, 1.3]));
  const later = t.free().sort((a, b) => b.points[0].x - a.points[0].x)[0];
  const [a, b] = [later.points[0], later.points.at(-1)];
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const square = [(-(b.y - a.y) / length) * 0.5, ((b.x - a.x) / length) * 0.5];
  assert.ok(await t.controller.updateWall(later.id, t.shift(later, square)));
  const before = t.parts();
  assert.ok(before.back, 'the move made a return');
  const [far, near] = [before.earlier.points[0], before.earlier.points.at(-1)];
  assert.ok(await t.controller.updateWall(before.back.id, t.shift(before.back, [-0.4, 0])));
  assert.deepEqual(t.reported, []);
  const end = t.parts().earlier.points.at(-1);
  const cross = (near.x - far.x) * (end.y - far.y) - (near.y - far.y) * (end.x - far.x);
  assert.ok(Math.abs(cross) / t.g ** 2 < 1e-4, 'on the earlier portion’s line');
  assert.ok(Math.abs(t.metres(end)[0] - (t.metres(near)[0] - 0.4)) < 0.05, 'about 0.4 back');
  t.controller.dispose();
});

test('a move that would shorten a portion to nothing is refused, the plan kept', async () => {
  const t = controllerFor();
  await withReturn(t);
  const before = t.parts();
  const plan = JSON.stringify(t.controller.session.getSnapshot());
  assert.equal(await t.controller.updateWall(before.back.id, t.shift(before.back, [2, 0])), null);
  assert.equal(t.reported[0]?.code, 'partition_return_collapse');
  assert.equal(JSON.stringify(t.controller.session.getSnapshot()), plan);
  t.controller.dispose();
});
