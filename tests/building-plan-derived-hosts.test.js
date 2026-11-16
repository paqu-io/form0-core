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
    property: 'wall_thickness',
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

test('a room drag that keeps the size within 1 mm moves and attaches the room', async () => {
  // Manual round, session 4007c4b7: a drawn room's size is not rounded, the host rounds the
  // dragged rectangle; the first drag must still be a move (with attach), not a resize.
  const f = createBuildingPlanExample();
  let record = f.record;
  const controller = new BuildingPlanCanvasController({
    meta: f.meta,
    readRecord: () => record,
    writeRecord: (next) => {
      record = next;
      return true;
    },
    derivedCommands: true,
  });
  const g = controller.gridSize;
  await controller.createRoom({
    x: 12.3456789 * g,
    y: 9.87654321 * g,
    width: 3.0000013 * g,
    height: 2.0000017 * g,
  });
  const created = controller.getSnapshot().rooms[2];
  const round = (value) => Math.round(value * 1000) / 1000;
  // Under Room 2 (x 3..8, bottom at 6.2), 0.3 m away: attach seats it one interior wall away.
  await controller.updateRoom(created.id, {
    x: 3 * g,
    y: 6.5 * g,
    width: round(created.rect.width),
    height: round(created.rect.height),
  });
  const floor = controller.session.getSnapshot().floors[0];
  const room = floor.rooms[2];
  assert.equal(Math.round(Math.min(...room.vertices.map((v) => v.y)) * 1000) / 1000, 6.4);
  const shared = floor.walls.filter(
    (wall) => wall.exposure === 'interior' && wall.sides.some((side) => side.roomId === room.id)
  );
  assert.equal(shared.length, 1);
  controller.dispose();
});
