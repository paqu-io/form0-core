import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildingPlanCanvasController, createBuildingPlanRecordSession } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

/** A thickness change: only the derived core lists the rooms it carved (`carvedRoomIds`). */
const thicker = (f, apply) =>
  apply({
    floorId: f.floorId,
    type: 'set_property',
    wallId: f.wallId,
    property: 'wall_thickness_m',
    value: 0.25,
    activeRoomId: f.snapshot.floors[0].rooms[0].id,
  });

test('the record session runs geometry commands on the derived core when hosts ask', () => {
  for (const derivedCommands of [false, true]) {
    const f = createBuildingPlanExample();
    const session = createBuildingPlanRecordSession({
      record: f.record,
      meta: f.meta,
      derivedCommands,
    });
    const result = thicker(f, (operation) => session.apply(operation));
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    assert.equal(Array.isArray(result.carvedRoomIds), derivedCommands);
  }
});

test('the canvas controller runs geometry commands on the derived core when hosts ask', () => {
  for (const derivedCommands of [false, true]) {
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
    const result = thicker(f, (operation) => controller.session.apply(operation));
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    assert.equal(Array.isArray(result.carvedRoomIds), derivedCommands);
  }
});
