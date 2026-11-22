import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildingPlanCanvasController } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

// F2 (2026-11-22): the canvas snapshot carries the floor directly below the floor shown (U1),
// its wall bands' and columns' outlines, for the canvas to draw under it; display only. The
// example's Ground floor stands at 0 m.

async function plan(upperValues) {
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
  const ground = setup.semanticSnapshot.floors[0];
  assert.ok(
    await setup.apply({
      type: 'create_element',
      floorId: ground.id,
      roomId: ground.rooms[0].id,
      collection: 'columns',
      element: { position: { x: 2, y: 1.5 }, width: 0.3, height: 0.4 },
      values: {},
    })
  );
  const upper = upperValues ? await setup.createFloor(upperValues) : null;
  setup.dispose();
  return { f, options, ground: ground.id, upper: upper?.id };
}
const canvas = (t, floorId) => new BuildingPlanCanvasController(t.options({ floorId }));

test('a floor above shows the floor below: its wall bands and columns, named', async () => {
  const t = await plan({ floor_elevation: 3 });
  const controller = canvas(t, t.upper);
  const below = controller.getSnapshot().floorBelow;
  assert.equal(below.id, t.ground);
  assert.equal(below.label, 'Ground floor');
  const g = controller.gridSize;
  const ground = canvas(t, t.ground).getSnapshot();
  assert.deepEqual(
    below.walls,
    ground.wallFootprints.flatMap((wall) => wall.polygons),
    'the same bands the Ground floor draws'
  );
  assert.deepEqual(
    below.columns.map((corners) => corners.map((p) => [p.x / g, p.y / g])),
    [
      [
        [1.85, 1.3],
        [2.15, 1.3],
        [2.15, 1.7],
        [1.85, 1.7],
      ],
    ]
  );
  controller.dispose();
});

test('none for the lowest floor, or a floor with no elevation (U1)', async () => {
  const t = await plan({});
  assert.equal(canvas(t, t.ground).getSnapshot().floorBelow, null, 'the lowest');
  assert.equal(canvas(t, t.upper).getSnapshot().floorBelow, null, 'no elevation yet');
  const level = await plan({ floor_elevation: 0 });
  assert.equal(canvas(level, level.upper).getSnapshot().floorBelow, null, 'the same level');
});

test('a preview on the floor above keeps it', async () => {
  const t = await plan({ floor_elevation: 3 });
  const controller = canvas(t, t.upper);
  const g = controller.gridSize;
  await controller.createRoom({ x: 0, y: 0, width: 3 * g, height: 2 * g });
  const below = controller.getSnapshot().floorBelow;
  const room = controller.getSnapshot().rooms[0];
  const corner = controller.getSnapshot().corners.find((entry) => entry.roomId === room.id);
  controller.previewCorner(room.id, corner.id, { x: corner.point.x + g / 2, y: corner.point.y });
  assert.ok(controller.previewView, 'a preview is shown');
  assert.deepEqual(controller.getSnapshot().floorBelow, below);
  controller.dispose();
});
