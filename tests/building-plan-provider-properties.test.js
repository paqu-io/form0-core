import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBuildingPlanEditor,
  createBuildingPlanSession,
  expandBuildingPlanSchema,
  readBuildingPlanRecord,
  settleBuildingPlanQuestions,
  writeBuildingPlanRecord,
} from '../src/index.js';

// 2026-11-16: a field that is both its row's own inherited property and a source its descendants
// inherit (the room's structural clear height: from the floor, to walls and columns) lost a typed
// value in the record. The guard below finds every such field from the schema, so a field added
// later with the same routing is checked without changing this file (see ROOM_SYSTEM_ROUTES in
// src/schema/building-plan-floors.js).

const schema = {
  form: {
    name: 'Provider properties',
    elements: [
      {
        type: 'BuildingPlanSection',
        key: 'plan',
        data_name: 'plan',
        label: 'Plan',
        description: null,
        description_mode: null,
        visible: true,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        node_overrides: null,
      },
    ],
  },
};
const meta = expandBuildingPlanSchema(schema).buildingPlanMeta[0];
const nodes = meta.repeatablesByNodeKey;
const name = (label) => ({ choice: [{ value: label.toLowerCase(), label }], other: [] });

/** Fields stored as a provider answer that are also their own node's inherited property. */
const doubleRole = Object.values(nodes).flatMap((node) =>
  node.fields
    .filter(
      (field) =>
        field.binding?.role === 'provider' &&
        Object.values(meta.properties).some(
          (spec) =>
            spec.nodeKey === node.nodeKey &&
            spec.property === field.originalDataName &&
            spec.inherit !== false
        )
    )
    .map((field) => ({ node, field }))
);

/** An editor on a floor (3.2 m) with Room A, a column in it, and Room B beside it. */
function plan() {
  const seed = createBuildingPlanSession({ properties: meta.properties, derivedCommands: true });
  const floorId = seed.apply({
    type: 'create_floor',
    values: {
      floor_name: name('Ground floor'),
      floor_elevation: 0,
      floor_height: 3.2,
      floor_interior_wall_thickness: 0.2,
      floor_exterior_wall_thickness: 0.2,
    },
  }).created.id;
  for (const [label, x] of [
    ['A', 0],
    ['B', 5.2],
  ])
    seed.apply({
      type: 'create_room',
      floorId,
      rectangle: { x, y: 0, width: 5, height: 4 },
      values: { room_name: name(label) },
    });
  const roomA = seed.getSnapshot().floors[0].rooms[0];
  seed.apply({
    type: 'create_element',
    floorId,
    roomId: roomA.id,
    collection: 'columns',
    element: { position: { x: 2, y: 1.5 }, width: 0.3, height: 0.3 },
  });
  return createBuildingPlanEditor({
    meta,
    derivedCommands: true,
    editingPolicy: { copyCustomAnswersAutomatically: true },
    record: writeBuildingPlanRecord({ meta, plan: seed.getSnapshot() }),
  });
}

/** The path of the first row of a node, walking the record. */
function firstPath(record, node) {
  const walk = (row, path) => {
    for (const [key, rows] of Object.entries(row.repeatable || {}))
      for (const child of rows) {
        const here = [...path, { key, id: child.id }];
        if (key === node.preferredKey) return here;
        const found = walk(child, here);
        if (found) return found;
      }
    return null;
  };
  return walk(record, []);
}
const rowAt = (record, path) =>
  path.reduce(
    (row, part) => row.repeatable[part.key].find((entry) => entry.id === part.id),
    record
  );

/** Edit one row as the apps do (open, complete, accept); answer any question with its first option. */
async function editRow(editor, path, values, reset = null) {
  const row = rowAt(editor.getRecord(), path);
  const scopeId = `edit-${Math.random()}`;
  editor.openRow({ path, scopeId });
  const pending = reset
    ? editor.updateRow(scopeId, row, { resetProperties: [reset] })
    : editor.completeRow(
        scopeId,
        { ...row, values: { ...row.values, ...values } },
        { finishAll: true }
      );
  const result = await settleBuildingPlanQuestions(editor, pending, async () => ({
    value: 'candidate:0',
  }));
  assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  assert.equal(editor.acceptRow(scopeId).status, 'accepted');
}

/** The plan object with this ID, anywhere in the snapshot. */
function findById(value, id) {
  if (!value || typeof value !== 'object') return null;
  if (value.id === id) return value;
  for (const child of Object.values(value)) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

/** The plan as it is after the record is read again (a reload, a reopened record). */
const reloaded = (editor) =>
  createBuildingPlanSession({
    snapshot: readBuildingPlanRecord({ meta, record: editor.getRecord() }),
    properties: meta.properties,
    derivedCommands: true,
  }).getSnapshot();

test('the room structural clear height is the field with both roles today', () => {
  assert.deepEqual(
    doubleRole.map(({ node, field }) => `${node.nodeKey}.${field.originalDataName}`),
    ['rooms.room_structural_clear_height']
  );
});

for (const { node, field } of doubleRole)
  test(`${node.nodeKey}.${field.originalDataName}: a typed value is the row's own value and survives the record`, async () => {
    const editor = plan();
    const path = firstPath(editor.getRecord(), node);
    await editRow(editor, path, { [field.dataName]: 2.6 });
    assert.equal(rowAt(editor.getRecord(), path).values[field.dataName], 2.6);
    const state = editor.fieldState(path, field.dataName);
    assert.equal(state.inheritable, true);
    assert.equal(state.source.mode, 'override');
    // After the record is read again, the row's subject still has the typed value as its own.
    const storage = node.fields.find((entry) => entry.binding?.role === 'storage').dataName;
    const modelId = JSON.parse(rowAt(editor.getRecord(), path).values[storage]).id;
    const subject = findById(reloaded(editor), modelId);
    assert.equal(subject?.properties?.[field.originalDataName], 2.6);
    await editRow(editor, path, null, field.dataName);
    assert.equal(editor.fieldState(path, field.dataName).source.mode, 'inherit');
  });

test("a room's own height reaches its walls and columns after the record is read again", async () => {
  const editor = plan();
  const path = firstPath(editor.getRecord(), nodes.rooms);
  const height = nodes.rooms.fieldsByOriginalDataName.room_structural_clear_height.dataName;
  await editRow(editor, path, { [height]: 2.6 });
  for (const snapshot of [editor.getSnapshot(), reloaded(editor)]) {
    const [roomA, roomB] = snapshot.floors[0].rooms;
    assert.equal(roomA.properties.room_structural_clear_height, 2.6);
    assert.equal(roomB.properties.room_structural_clear_height, 3.2);
    assert.equal(roomA.columns[0].properties.column_height, 2.6);
    const own = snapshot.floors[0].walls.filter(
      (wall) => wall.sides.filter((side) => side.roomId).length === 1
    );
    for (const wall of own) {
      const room = wall.sides.find((side) => side.roomId).roomId;
      assert.equal(wall.properties.wall_height, room === roomA.id ? 2.6 : 3.2, wall.autoLabel);
    }
  }
  // Reset to inheritance: the floor's height again, for the room and what follows it.
  await editRow(editor, path, null, height);
  const after = reloaded(editor);
  assert.equal(after.floors[0].rooms[0].properties.room_structural_clear_height, 3.2);
  assert.equal(after.floors[0].rooms[0].columns[0].properties.column_height, 3.2);
});
