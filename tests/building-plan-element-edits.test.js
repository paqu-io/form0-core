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

// 2026-11-20 (unit 3 hand test): typing a column's width or depth in its entry made it vanish
// from the canvas. The row's position fields are geometry, not plain values, so the edit was
// sent without them and the element lost its position. A beam lost its ends the same way.

const schema = {
  form: {
    name: 'Element edits',
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
const field = (node, name) => nodes[node].fieldsByOriginalDataName[name].dataName;
const name = (label) => ({ choice: [{ value: label.toLowerCase(), label }], other: [] });

/** An editor on a floor with a 5 × 4 m room holding a column at (2, 1.5) and a beam. */
function plan() {
  const seed = createBuildingPlanSession({ properties: meta.properties, derivedCommands: true });
  const floorId = seed.apply({
    type: 'create_floor',
    values: {
      floor_name: name('Ground floor'),
      floor_elevation: 0,
      floor_height: 3,
      floor_interior_wall_thickness: 0.2,
      floor_exterior_wall_thickness: 0.2,
    },
  }).created.id;
  seed.apply({
    type: 'create_room',
    floorId,
    rectangle: { x: 0, y: 0, width: 5, height: 4 },
    values: { room_name: name('A') },
  });
  const roomId = seed.getSnapshot().floors[0].rooms[0].id;
  seed.apply({
    type: 'create_element',
    floorId,
    roomId,
    collection: 'columns',
    element: { position: { x: 2, y: 1.5 }, width: 0.3, height: 0.3 },
  });
  seed.apply({
    type: 'create_element',
    floorId,
    roomId,
    collection: 'beams',
    element: { start: { x: 1, y: 3 }, end: { x: 4, y: 3 }, width: 0.2, height: 0.3 },
  });
  return createBuildingPlanEditor({
    meta,
    derivedCommands: true,
    editingPolicy: { copyCustomAnswersAutomatically: true },
    record: writeBuildingPlanRecord({ meta, plan: seed.getSnapshot() }),
  });
}

const pathTo = (record, nodeKey) => {
  const floors = nodes.floors.preferredKey;
  const rooms = nodes.rooms.preferredKey;
  const key = nodes[nodeKey].preferredKey;
  const floor = record.repeatable[floors][0];
  const room = floor.repeatable[rooms][0];
  return [
    { key: floors, id: floor.id },
    { key: rooms, id: room.id },
    { key, id: room.repeatable[key][0].id },
  ];
};
const rowAt = (record, path) =>
  path.reduce(
    (row, part) => row.repeatable[part.key].find((entry) => entry.id === part.id),
    record
  );

/** Edit one row as the apps do (open, complete, accept). */
async function editRow(editor, path, values) {
  const row = rowAt(editor.getRecord(), path);
  const scopeId = `edit-${Math.random()}`;
  editor.openRow({ path, scopeId });
  const pending = editor.completeRow(
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

const room = (editor) =>
  readBuildingPlanRecord({ meta, record: editor.getRecord() }).floors[0].rooms[0];

test("a column's width or depth typed in its entry: it keeps its place", async () => {
  const editor = plan();
  const path = pathTo(editor.getRecord(), 'columns');
  await editRow(editor, path, { [field('columns', 'column_width')]: 0.5 });
  await editRow(editor, path, { [field('columns', 'column_depth')]: 0.4 });
  const [column] = room(editor).columns;
  assert.deepEqual(column.position, { x: 2, y: 1.5 });
  assert.equal(column.width, 0.5);
  assert.equal(column.height, 0.4);
  const row = rowAt(editor.getRecord(), path);
  assert.equal(row.values[field('columns', 'column_center_u')], 0.4);
  assert.equal(row.values[field('columns', 'column_center_v')], 0.375);
});

test("a beam's width typed in its entry: it keeps its ends", async () => {
  const editor = plan();
  await editRow(editor, pathTo(editor.getRecord(), 'beams'), {
    [field('beams', 'beam_width')]: 0.25,
  });
  const [beam] = room(editor).beams;
  assert.deepEqual(
    [beam.start, beam.end],
    [
      { x: 1, y: 3 },
      { x: 4, y: 3 },
    ]
  );
  assert.equal(beam.width, 0.25);
});
