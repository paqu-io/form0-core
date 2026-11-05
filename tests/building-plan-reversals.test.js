import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import { BuildingPlanCanvasController, readBuildingPlanRecord } from '../src/index.js';
import { pointInPolygon } from '../src/building-plan/geometry.js';

function fixture(editingPolicy) {
  const f = createBuildingPlanExample();
  let record = f.record;
  const controller = new BuildingPlanCanvasController({
    meta: f.meta,
    editingPolicy,
    readRecord: () => record,
    writeRecord: (next) => {
      record = next;
    },
  });
  return { ...f, controller, plan: () => readBuildingPlanRecord({ meta: f.meta, record }) };
}
async function move(f, id, y, snapping = false, zoom = 1) {
  const wall = f.controller.getSnapshot().walls.find((wall) => wall.id === id);
  const original = wall.points;
  f.controller.interaction.begin();
  let points;
  for (let i = 1; i <= 24; i++) {
    points = f.controller.interaction.snapTranslation(
      original.map((p) => ({
        ...p,
        y: p.y + ((y * 20 - original[0].y) * i) / 24,
      })),
      {
        roomId: wall.roomId,
        faceId: id,
        physicalWallId: wall.physicalWallId,
        originalPoints: original,
        bypass: !snapping,
        zoom,
      }
    );
    const preview = f.controller.previewWall(id, points);
    assert.equal(preview.status, 'ready', JSON.stringify(preview.issues));
  }
  const result = await f.controller.updateWall(id, points);
  f.controller.clearPreview();
  assert.ok(result);
  return points[0].y / 20;
}

for (const preserveWallGrouping of [false, true])
  for (const downFirst of [false, true])
    test(`shared-face reversal keeps a single material band (down=${downFirst}, grouped=${preserveWallGrouping})`, async () => {
      const f = fixture({ preserveWallGrouping });
      try {
        await move(f, f.faceB, downFirst ? 3.8 : 2.6);
        await move(f, f.faceB, downFirst ? 2.6 : 3.8);
        const view = f.controller.getSnapshot();
        const covers = (x, y) =>
          view.wallFootprints.some((wall) =>
            wall.polygons.some((polygon) => pointInPolygon({ x: x * 20, y: y * 20 }, polygon))
          );
        assert.ok(covers(2.9, downFirst ? 2.8 : 3.2));
        assert.equal(covers(3.1, downFirst ? 2.8 : 3.2), false, 'No second 0.20 m return band');
        assert.deepEqual(f.plan().floors[0].observations, f.snapshot.floors[0].observations);
      } finally {
        f.controller.dispose();
      }
    });

for (const [first, second] of [
  [3.407, 2.631],
  [2.631, 3.407],
])
  test(`fractional reversal previews keep valid bindings without an exact original-line stop (${first})`, async () => {
    const f = fixture();
    try {
      await move(f, f.faceB, first);
      await move(f, f.faceB, second);
    } finally {
      f.controller.dispose();
    }
  });

test('short jog centres remain wall targets while their endpoint remains a corner target', async () => {
  const f = fixture();
  try {
    await move(f, f.faceA, 3.4);
    const returnWall = f.controller
      .getSnapshot()
      .walls.find(
        (w) =>
          w.roomId === f.plan().floors[0].rooms[1].id &&
          w.points.length === 2 &&
          Math.abs(w.points[0].x - 104) < 1e-6 &&
          Math.abs(w.points[1].x - 104) < 1e-6
      );
    assert.ok(returnWall);
    const [a, b] = returnWall.points;
    for (const options of [{ roomId: returnWall.roomId }, { preferredRoomId: returnWall.roomId }])
      assert.equal(
        f.controller.getCornerPlacement({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, options),
        null
      );
    assert.ok(f.controller.getCornerPlacement(a));
  } finally {
    f.controller.dispose();
  }
});

for (const zoom of [1, 2.5, 4, 6])
  test(`W3.2 snaps to physical contact when the pointer reaches the other room face (zoom=${zoom})`, async () => {
    const f = fixture();
    try {
      await move(f, f.faceB, 2.6);
      await move(f, f.faceB, 3.8);
      const left = f.controller.getSnapshot().walls.find((wall) => wall.displayLabel === 'W3.2');
      assert.ok(left);
      const y = await move(f, left.id, 3.8, true, zoom);
      assert.equal(y, 3.6, 'Align the physical band while preserving the 0.20 m face separation');
      assert.equal(f.plan().floors[0].rooms[0].vertices.length, 4);
    } finally {
      f.controller.dispose();
    }
  });
