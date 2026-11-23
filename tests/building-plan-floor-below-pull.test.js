import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildingPlanCanvasController } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

// F3 (2026-11-22; U5 to U8): drawing a room, a room corner, a room wall and moving a room are
// pulled into line with the floor below's corners (its wall bands' corners, both faces), with
// today's pull (8 px, 13 held, Alt none); nearest wins, a tie goes to this floor; a guide from a
// corner below is marked `below` (the canvas rings it).

async function upperFloor() {
  const f = createBuildingPlanExample();
  let record = f.record;
  const options = (extra = {}) => ({
    meta: f.meta,
    derivedCommands: true,
    readRecord: () => record,
    writeRecord: (next) => {
      record = next;
      return true;
    },
    ...extra,
  });
  const setup = new BuildingPlanCanvasController(options());
  const upper = await setup.createFloor({ floor_elevation: 3 });
  setup.dispose();
  const controller = new BuildingPlanCanvasController(options({ floorId: upper.id }));
  const g = controller.gridSize;
  const corners = controller.getSnapshot().floorBelow.walls.flat();
  return { controller, g, corners, interaction: controller.interaction };
}
/** A corner below with no other corner below within `gap` on either axis. */
function lone(corners, gap) {
  return corners.find((c) =>
    corners.every(
      (o) =>
        o === c ||
        ((Math.abs(o.x - c.x) > gap || o.x === c.x) && (Math.abs(o.y - c.y) > gap || o.y === c.y))
    )
  );
}

test('drawing a room: a corner pulls into line with a corner below, the guide marked', async () => {
  const t = await upperFloor();
  const c = lone(t.corners, 2);
  t.interaction.begin();
  const snapped = t.interaction.snapPoint({ x: c.x + 1, y: c.y - 0.8 }, { zoom: 5 });
  assert.deepEqual(snapped, { x: c.x, y: c.y });
  const guides = t.interaction.getGuides();
  assert.equal(guides.length, 2);
  assert.ok(guides.every((guide) => guide.below));
  assert.deepEqual(
    t.interaction.snapPoint({ x: c.x + 1, y: c.y - 0.8 }, { zoom: 5, bypass: true }),
    {
      x: c.x + 1,
      y: c.y - 0.8,
    }
  );
  assert.deepEqual(t.interaction.snapPoint({ x: c.x + 3, y: c.y }, { zoom: 5 }).x, c.x + 3);
  t.controller.dispose();
});

test('nearest wins; a tie goes to a corner of this floor', async () => {
  const t = await upperFloor();
  const c = lone(t.corners, 2);
  // A room on this floor with its left side 1.2 units (6 cm) right of the corner below.
  await t.controller.createRoom({ x: c.x + 1.2, y: c.y + 200, width: 100, height: 100 });
  t.interaction.begin();
  const tie = t.interaction.snapPoint({ x: c.x + 0.6, y: c.y + 400 }, { zoom: 5 });
  assert.ok(Math.abs(tie.x - (c.x + 1.2)) < 1e-9, 'equally near: this floor');
  assert.ok(!t.interaction.getGuides()[0].below);
  const nearer = t.interaction.snapPoint({ x: c.x + 0.5, y: c.y + 400 }, { zoom: 5 });
  assert.equal(nearer.x, c.x, 'nearer: the floor below');
  assert.ok(t.interaction.getGuides()[0].below);
  t.controller.dispose();
});

test('a room corner and a moved room pull to the floor below', async () => {
  const t = await upperFloor();
  const c = lone(t.corners, 2);
  await t.controller.createRoom({ x: c.x + 50, y: c.y + 50, width: 101.3, height: 77.7 });
  const room = t.controller.getSnapshot().rooms[0];
  const corner = t.controller.getSnapshot().corners.find((entry) => entry.roomId === room.id);
  t.interaction.begin();
  // A corner dragged along x towards the corner below's x.
  const dragged = t.interaction.snapCorner(
    { x: c.x + 1, y: corner.point.y },
    { roomId: room.id, vertexId: corner.id, originalPoint: corner.point, zoom: 5 }
  );
  assert.equal(dragged.x, c.x);
  assert.ok(t.interaction.getGuides().some((guide) => guide.below));
  // The whole room moved so that its corner lands 1 and 0.8 units off the corner below.
  t.interaction.begin();
  const shift = { x: c.x + 1 - corner.point.x, y: c.y - 0.8 - corner.point.y };
  const moved = t.interaction.snapTranslation(
    room.vertices.map((p) => ({ x: p.x + shift.x, y: p.y + shift.y })),
    { roomId: room.id, zoom: 5, originalPoints: room.vertices }
  );
  const at =
    moved[
      room.vertices.indexOf(
        room.vertices.find((p) => p.x === corner.point.x && p.y === corner.point.y)
      )
    ];
  assert.deepEqual({ x: at.x, y: at.y }, { x: c.x, y: c.y });
  assert.ok(t.interaction.getGuides().every((guide) => guide.below));
  t.controller.dispose();
});

// Step 2, S4 (2026-11-22): the floor below's switch also stops its pulls; the snapshot keeps it.
test('the floor below pulls only while its pulls are on', async () => {
  const t = await upperFloor();
  const c = lone(t.corners, 2);
  const near = { x: c.x + 1, y: c.y - 0.8 };
  t.controller.setFloorBelowPulls(false);
  t.interaction.begin();
  const free = t.interaction.snapPoint(near, { zoom: 5 });
  assert.notDeepEqual(free, { x: c.x, y: c.y });
  assert.ok(!t.interaction.getGuides().some((guide) => guide.below));
  assert.ok(t.controller.getSnapshot().floorBelow, 'still there to draw');
  t.controller.setFloorBelowPulls(true);
  t.interaction.begin();
  assert.deepEqual(t.interaction.snapPoint(near, { zoom: 5 }), { x: c.x, y: c.y });
  assert.ok(t.interaction.getGuides().every((guide) => guide.below));
  t.controller.dispose();
});
