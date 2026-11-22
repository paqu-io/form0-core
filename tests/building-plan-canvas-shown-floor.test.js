import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildingPlanCanvasController } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

// F1 (2026-11-22): a new floor's entry showed the first floor (its tab not active), and drawing
// there went to that floor. A canvas shows the floor it is given (an entry's own), by id.

async function twoFloors() {
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
  const first = new BuildingPlanCanvasController(options());
  const created = await first.createFloor({});
  first.dispose();
  const floors = () => new BuildingPlanCanvasController(options()).semanticSnapshot.floors;
  return { f, options, ground: floors()[0].id, upper: created.id ?? floors()[1].id };
}

test('a canvas given an entry’s floor shows it from the start, its tab active', async () => {
  const t = await twoFloors();
  const controller = new BuildingPlanCanvasController(t.options({ floorId: t.upper }));
  assert.equal(controller.floorId, t.upper);
  const tabs = controller.getSnapshot().floors;
  assert.equal(tabs[controller.activeFloorIndex].id, t.upper);
  assert.equal(controller.getSnapshot().rooms.length, 0, 'the new floor has no rooms yet');
  controller.dispose();
  const plain = new BuildingPlanCanvasController(t.options());
  assert.equal(plain.floorId, t.ground, 'none given: the first');
  plain.dispose();
});

test('drawing in it goes to that floor', async () => {
  const t = await twoFloors();
  const controller = new BuildingPlanCanvasController(t.options({ floorId: t.upper }));
  const g = controller.gridSize;
  await controller.createRoom({ x: 0, y: 0, width: 3 * g, height: 2 * g });
  const plan = controller.session.getSnapshot();
  assert.equal(plan.floors.find((floor) => floor.id === t.upper).rooms.length, 1);
  assert.equal(plan.floors.find((floor) => floor.id === t.ground).rooms.length, 2);
  controller.dispose();
});

test('it stays on that floor as the plan changes; showFloor and the tabs change it', async () => {
  const t = await twoFloors();
  const controller = new BuildingPlanCanvasController(t.options({ floorId: t.upper }));
  controller.syncFromState();
  assert.equal(controller.floorId, t.upper);
  controller.showFloor(t.ground);
  assert.equal(controller.floorId, t.ground);
  const upperIndex = controller.semanticSnapshot.floors.findIndex((f) => f.id === t.upper);
  controller.setActiveFloor(upperIndex);
  controller.syncFromState();
  assert.equal(controller.floorId, t.upper, 'a tab chosen is the floor shown');
  controller.showFloor('no-such-floor');
  assert.equal(controller.floorId, t.upper, 'a floor the plan lacks keeps the one shown');
  controller.dispose();
});
