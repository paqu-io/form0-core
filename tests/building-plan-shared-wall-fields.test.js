import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBuildingPlanEditor,
  createBuildingPlanSession,
  writeBuildingPlanRecord,
} from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

// A shared wall shown as shared (2026-11-23): a whole-wall field's state names the other rooms
// the wall stands between (`sharedWith`), as the shared-value question names them, so its entry
// can say a value set there applies to them too. A side's field and a wall one room has: none.

/** An editor on the example (two Bedrooms sharing W3), its second room renamed when asked. */
function example(secondName = null) {
  const f = createBuildingPlanExample();
  let record = f.record;
  if (secondName) {
    const session = createBuildingPlanSession({
      snapshot: f.snapshot,
      properties: f.meta.properties,
      derivedCommands: true,
    });
    const floor = session.getSnapshot().floors[0];
    const result = session.apply({
      type: 'set_values',
      floorId: floor.id,
      nodeKey: 'rooms',
      roomId: floor.rooms[1].id,
      elementId: floor.rooms[1].id,
      values: { room_name: { choice: [], other: [{ value: secondName, label: secondName }] } },
    });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    record = writeBuildingPlanRecord({ meta: f.meta, plan: session.getSnapshot() });
  }
  const editor = createBuildingPlanEditor({ meta: f.meta, derivedCommands: true, record });
  const walls = f.meta.repeatablesByNodeKey.walls;
  const field = (test) => walls.fields.find(test).dataName;
  return {
    editor,
    height: field((entry) => entry.binding?.property === 'wall_height'),
    material: field((entry) => entry.originalDataName === 'material'),
    finish: field((entry) => entry.originalDataName === 'finish'),
    // The first room's wall rows.
    paths: (() => {
      const key = (nodeKey) => f.meta.repeatablesByNodeKey[nodeKey].preferredKey;
      const floor = editor.getRecord().repeatable[key('floors')][0];
      const room = floor.repeatable[key('rooms')][0];
      const base = [
        { key: key('floors'), id: floor.id },
        { key: key('rooms'), id: room.id },
      ];
      return room.repeatable[key('walls')].map((row) => [
        ...base,
        { key: key('walls'), id: row.id },
      ]);
    })(),
  };
}

test('a whole-wall field of a shared wall names the other room; two Bedrooms by position', () => {
  const t = example();
  assert.ok(t.paths.length >= 4, 'the Bedroom’s walls');
  const states = t.paths.map((path) => t.editor.fieldState(path, t.height));
  const shared = states.filter((state) => state.sharedWith.length);
  assert.equal(shared.length, 1, 'W3 alone, of the first Bedroom’s walls');
  assert.deepEqual(
    shared[0].sharedWith.map((entry) => entry.name),
    ['Bedroom (room 2)']
  );
  const path = t.paths[states.indexOf(shared[0])];
  // The form's own whole-wall field too; a side's field never.
  assert.deepEqual(
    t.editor.fieldState(path, t.material).sharedWith.map((entry) => entry.name),
    ['Bedroom (room 2)']
  );
  assert.deepEqual(t.editor.fieldState(path, t.finish).sharedWith, []);
});

test('a room with its own name is named alone', () => {
  const t = example('Kitchen');
  const names = t.paths
    .map((path) => t.editor.fieldState(path, t.height).sharedWith.map((entry) => entry.name))
    .filter((list) => list.length);
  assert.deepEqual(names, [['Kitchen']]);
});
