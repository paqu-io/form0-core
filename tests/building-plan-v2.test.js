import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBuildingPlanSession,
  BuildingPlanCanvasController,
  createBuildingPlanEditor,
  expandBuildingPlanSchema,
  writeBuildingPlanRecord,
  readBuildingPlanRecord,
  createRecordEvaluator,
} from '../src/index.js';
import { BUILDING_PLAN_BLUEPRINT } from '../src/schema/building-plan-blueprint.js';
import { normalizePhysicalPieces } from '../src/building-plan/physical-pieces.js';
import { mergeWallSides } from '../src/building-plan/wall-sides.js';
import {
  numericField,
  textField,
  calculatedField,
  repeatableSection,
} from './helpers/calculation-fixtures.js';

function fixture(overrides = {}, policy = {}) {
  const schema = {
    form: {
      name: 'V2',
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
          node_overrides: overrides,
        },
      ],
    },
  };
  const expanded = expandBuildingPlanSchema(schema),
    meta = expanded.buildingPlanMeta[0];
  let serial = 0;
  const session = createBuildingPlanSession({
    properties: meta.properties,
    createId: () => `v2-${++serial}`,
    editingPolicy: policy,
  });
  const apply = (operation) => {
    const result = session.apply(operation);
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    return result;
  };
  const floorId = apply({ type: 'create_floor' }).created.id;
  const add = (rectangle) => apply({ type: 'create_room', floorId, rectangle }).created.id;
  const floor = () => session.getSnapshot().floors[0];
  return { schema, expanded: expanded.schema, meta, session, apply, floorId, add, floor };
}
const source = (name, exposure) =>
  numericField(name, {
    building_plan: {
      property: 'wall_thickness_m',
      scope: 'physical_wall',
      inherit_to: 'walls',
      applies_to: { exposure },
    },
  });
function adjacent(f) {
  f.add({ x: 0, y: 0, width: 6, height: 3 });
  f.add({ x: 2, y: 3 + f.floor().walls[0].properties.wall_thickness_m, width: 2, height: 3 });
  const floor = f.floor();
  return {
    type: 'bind_faces',
    floorId: f.floorId,
    referenceFaceId: floor.rooms[0].faces[2].id,
    faceId: floor.rooms[1].faces[0].id,
  };
}
// Topology transitions review inherited changes here; 'apply' is the editor default.
function transition(policy = {}) {
  const f = fixture(
    {
      floors: { extra_elements: [source('external', 'exterior'), source('internal', 'interior')] },
    },
    { inheritedChangePolicy: 'ask', ...policy }
  );
  f.apply({ type: 'set_values', floorId: f.floorId, values: { external: 0.4, internal: 0.2 } });
  return { f, operation: adjacent(f) };
}
function answer(f, result, value = 'apply') {
  assert.equal(result.status, 'pending', JSON.stringify(result.issues));
  assert.equal(result.uiOperations.length, 1);
  return f.session.resolveUIRequest(result.uiOperations[0].params.requestId, { value });
}

test('authored schemas round trip without generated controls; expanded structure is protected', () => {
  const f = fixture({ rooms: { extra_elements: [textField('note')] } }),
    raw = JSON.stringify(f.schema);
  assert.equal(f.meta.version, 2);
  assert.equal(JSON.stringify(f.schema), raw);
  assert.equal(expandBuildingPlanSchema(f.expanded).buildingPlanMeta.length, 1);
  const edited = structuredClone(f.expanded);
  edited.form.elements[0].elements[0].elements[0].visible = false;
  assert.throws(() => expandBuildingPlanSchema(edited), /protected/);
  assert.ok(!JSON.stringify(f.schema).includes('bp_floors_system'));
  assert.throws(
    () => fixture({ walls: { extra_elements: [numericField('wall_thickness_m')] } }),
    /managed/
  );
  assert.throws(() => fixture({ walls: { mandatory_elements: [] } }), /managed/);
});

test('system catalog retains names and dimensions in mandatory protected inline sections', () => {
  const f = fixture();
  assert.equal(f.meta.repeatablesByNodeKey.observations, undefined);
  const customCategory = fixture({ objects: { extra_elements: [textField('object_category')] } });
  assert.ok(
    !customCategory.meta.repeatablesByNodeKey.objects.fieldsByOriginalDataName.object_category
      .binding?.system
  );
  for (const node of f.meta.repeatables)
    for (const entry of node.fields) {
      if (
        entry.binding?.system &&
        !['storage', 'geometry', 'derived'].includes(entry.binding.role) &&
        !['storage', 'geometry', 'derived'].includes(entry.binding.storageRole) &&
        !['floors', 'rooms'].includes(node.nodeKey) &&
        !entry.originalDataName.startsWith('wall_plaster')
      )
        assert.equal(entry.field.required, true, entry.originalDataName);
    }
  assert.ok(
    BUILDING_PLAN_BLUEPRINT.nodes.floors.mandatory_elements.some(
      (field) => field.data_name === 'floor_height'
    )
  );
});

for (const value of ['apply', 'preserve', 'cancel'])
  test(`one managed topology question can ${value} inherited thickness`, () => {
    const { f, operation } = transition();
    const before = f.session.getSnapshot();
    const pending = f.session.apply(operation);
    assert.deepEqual(f.session.getSnapshot(), before);
    const result = answer(f, pending, value);
    assert.equal(
      result.status,
      value === 'cancel' ? 'unchanged' : 'applied',
      JSON.stringify(result.issues)
    );
    if (value === 'cancel') assert.deepEqual(f.session.getSnapshot(), before);
    else {
      const middle = f.floor().walls.find((wall) => wall.exposure === 'interior');
      assert.equal(middle.properties.wall_thickness_m, value === 'apply' ? 0.2 : 0.4);
      assert.equal(Object.hasOwn(middle.overrides, 'wall_thickness_m'), value === 'preserve');
      assert.equal(f.session.undo().status, 'undone');
      assert.deepEqual(f.session.getSnapshot(), before);
      assert.equal(f.session.redo().status, 'redone');
    }
    assert.equal(
      f.session.resolveUIRequest(pending.uiOperations[0].params.requestId, { value }).status,
      'conflict'
    );
  });

test('apply preference affects future operations and preserves explicit physical overrides', () => {
  const { f, operation } = transition();
  const before = f.session.getSnapshot(),
    state = f.session.getState();
  f.session.setEditingPolicy({ inheritedChangePolicy: 'apply' });
  assert.deepEqual(f.session.getSnapshot(), before);
  assert.deepEqual(f.session.getState(), state);
  f.apply(operation);
  assert.equal(
    f.floor().walls.find((wall) => wall.exposure === 'interior').properties.wall_thickness_m,
    0.2
  );
  const g = transition({ inheritedChangePolicy: 'apply' });
  const wall = g.f
    .floor()
    .walls.find((wall) => wall.referenceFaceId === g.operation.referenceFaceId);
  g.f.apply({
    type: 'set_property',
    floorId: g.f.floorId,
    wallId: wall.id,
    property: 'wall_thickness_m',
    value: 0.4,
  });
  g.f.apply(g.operation);
  assert.equal(
    g.f.floor().walls.find((wall) => wall.exposure === 'interior').properties.wall_thickness_m,
    0.4
  );
});

test('a newer candidate or closed editor invalidates the old decision', () => {
  const { f, operation } = transition();
  const scope = f.session.beginScope();
  const pending = f.session.apply(operation, { scopeId: scope.scopeId });
  f.session.cancelScope(scope.scopeId);
  assert.equal(
    f.session.resolveUIRequest(pending.uiOperations[0].params.requestId, { value: 'apply' }).status,
    'conflict'
  );
  const newer = f.session.apply(operation);
  f.session.preview({ type: 'set_values', floorId: f.floorId, values: { note: 'later' } });
  assert.equal(
    f.session.resolveUIRequest(newer.uiOperations[0].params.requestId, { value: 'apply' }).status,
    'conflict'
  );
});

test('equal physical defaults do not ask when only adjacency or sources change', () => {
  const { f, operation } = transition();
  f.apply({ type: 'set_values', floorId: f.floorId, values: { internal: 0.4 } });
  f.apply(operation);
  const shared = f.floor().walls.find((wall) => wall.exposure === 'interior');
  assert.equal(shared.properties.wall_thickness_m, 0.4);
  assert.equal(shared.segments.length, 1);
});

test('a physical edit from either room addresses the complete shared piece', () => {
  const f = fixture();
  const op = adjacent(f);
  f.apply(op);
  const shared = f.floor().walls.find((wall) => wall.exposure === 'interior');
  const face = f.floor().rooms[1].faces.find((face) => face.wallId === shared.id);
  f.apply({
    type: 'set_property',
    floorId: f.floorId,
    faceId: face.id,
    property: 'wall_thickness_m',
    value: 0.3,
  });
  assert.equal(
    f.floor().walls.find((wall) => wall.id === shared.id).overrides.wall_thickness_m,
    0.3
  );
  assert.ok(f.floor().walls.every((wall) => wall.segments.every((segment) => !segment.overrides)));
});

test('outside surface identity and explicit answers survive becoming room-facing', () => {
  const f = fixture({
    walls: {
      extra_elements: [
        textField('finish', { building_plan: { scope: 'wall_face', on_split: 'copy' } }),
      ],
    },
  });
  const op = adjacent(f),
    wall = f.floor().walls.find((wall) => wall.referenceFaceId === op.referenceFaceId);
  const outside = wall.sides.find((side) => side.roomId == null);
  f.apply({
    type: 'set_property',
    floorId: f.floorId,
    faceId: op.referenceFaceId,
    scope: 'wall_face',
    property: 'finish',
    outside: true,
    value: 'render',
  });
  f.apply(op);
  const middle = f.floor().walls.find((wall) => wall.exposure === 'interior');
  const side =
    middle.sides.find((side) => side.id === outside.id) ||
    middle.sides.find((side) => side.overrides.finish === 'render');
  assert.ok(side.roomId);
  assert.equal(side.overrides.finish, 'render');
  const record = writeBuildingPlanRecord({ meta: f.meta, plan: f.session.getSnapshot() });
  assert.equal(
    readBuildingPlanRecord({ meta: f.meta, record })
      .floors[0].walls.find((wall) => wall.id === middle.id)
      .sides.find((entry) => entry.id === side.id).overrides.finish,
    'render'
  );
});

test('a free partition within one room has room space on both canonical sides', () => {
  const f = fixture();
  const roomId = f.add({ x: 0, y: 0, width: 6, height: 4 });
  const created = f.apply({
    type: 'create_wall',
    floorId: f.floorId,
    roomId,
    vertices: [
      { x: 1, y: 2 },
      { x: 5, y: 2 },
    ],
  });
  const wall = f.floor().walls.find((wall) => wall.id === created.created.id);
  assert.equal(wall.exposure, 'interior');
  assert.ok(wall.sides.every((side) => side.roomId === roomId));
});

test('explicit custom answers require copying confirmation; safe starter values do not', () => {
  const f = fixture({
    walls: { extra_elements: [textField('note', { building_plan: { scope: 'physical_wall' } })] },
  });
  f.add({ x: 0, y: 0, width: 6, height: 3 });
  const face = f.floor().rooms[0].faces[0];
  f.apply({
    type: 'set_property',
    floorId: f.floorId,
    wallId: face.wallId,
    property: 'note',
    value: 'inspect',
  });
  const before = f.session.getSnapshot();
  const pending = f.session.apply({
    type: 'split_face',
    floorId: f.floorId,
    faceId: face.id,
    offset: 2,
  });
  assert.deepEqual(f.session.getSnapshot(), before);
  assert.equal(answer(f, pending).status, 'applied');
  assert.equal(f.floor().walls.filter((wall) => wall.overrides.note === 'inspect').length, 2);
});

for (const automatic of [false, true])
  test(`custom copy preference authorizes scalar and nested row transfers (${automatic})`, () => {
    const inspections = repeatableSection('inspections', [textField('comment')]);
    inspections.building_plan = { scope: 'physical_wall' };
    const f = fixture({
      walls: {
        extra_elements: [
          inspections,
          textField('note', { building_plan: { scope: 'physical_wall', on_split: 'confirm' } }),
        ],
      },
    });
    f.add({ x: 0, y: 0, width: 6, height: 3 });
    const face = f.floor().rooms[0].faces[0];
    f.apply({
      type: 'set_property',
      floorId: f.floorId,
      wallId: face.wallId,
      property: 'note',
      value: 'surveyed',
    });
    f.apply({
      type: 'set_custom_rows',
      floorId: f.floorId,
      wallId: face.wallId,
      repeatable: {
        inspections: [{ id: 'original-inspection', values: { comment: 'survey' }, repeatable: {} }],
      },
    });
    const before = f.session.getSnapshot(),
      state = f.session.getState();
    f.session.setEditingPolicy({ copyCustomAnswersAutomatically: automatic });
    assert.deepEqual(f.session.getSnapshot(), before);
    assert.deepEqual(f.session.getState(), state);
    const result = f.session.apply({
      type: 'split_face',
      floorId: f.floorId,
      faceId: face.id,
      offset: 2,
    });
    assert.equal(result.status, automatic ? 'applied' : 'pending', JSON.stringify(result.issues));
    if (!automatic) assert.equal(answer(f, result).status, 'applied');
    const copies = f.floor().walls.filter((wall) => wall.overrides.note === 'surveyed');
    assert.equal(copies.length, 2);
    const rows = copies.flatMap((wall) => wall.repeatable.inspections);
    assert.equal(new Set(rows.map((row) => row.id)).size, 2);
    assert.ok(rows.every((row) => row.values.comment === 'survey'));
    f.session.undo();
    assert.deepEqual(f.session.getSnapshot(), before);
  });

test('automatic custom copying leaves inherited reviews and genuine conflicts active', () => {
  const { f, operation } = transition({ copyCustomAnswersAutomatically: true });
  const before = f.session.getSnapshot();
  const result = f.session.apply(operation);
  assert.equal(result.status, 'pending');
  assert.match(result.uiOperations[0].params.message, /inherited physical/);
  assert.equal(answer(f, result, 'cancel').status, 'unchanged');
  assert.deepEqual(f.session.getSnapshot(), before);
});

test('splitting a previously detached piece compares defaults with its immediate physical parent', () => {
  const f = fixture(
    {
      walls: {
        extra_elements: [
          textField('note', {
            building_plan: { scope: 'physical_wall', on_split: 'copy' },
          }),
        ],
      },
    },
    { copyCustomAnswersAutomatically: true }
  );
  f.apply(adjacent(f));
  const roomId = f.floor().rooms[0].id;
  let wall = f.floor().walls.find((wall) => wall.sides.every((side) => side.roomId));
  f.apply({
    type: 'set_property',
    floorId: f.floorId,
    wallId: wall.id,
    property: 'note',
    value: 'Shared inspection',
  });
  f.apply({ type: 'move_room', floorId: f.floorId, roomId, delta: { x: 0, y: -5 } });
  f.apply({
    type: 'set_defaults',
    floorId: f.floorId,
    roomId,
    property: 'wall_height_m',
    value: 4,
  });
  const room = f.floor().rooms[0];
  const face = room.faces.find(
    (face) => f.floor().walls.find((wall) => wall.id === face.wallId).overrides.note
  );
  wall = f.floor().walls.find((wall) => wall.id === face.wallId);
  assert.equal(wall.properties.wall_height_m, 4);
  const result = f.session.apply({
    type: 'split_face',
    floorId: f.floorId,
    faceId: face.id,
    offset: 1,
  });
  assert.equal(
    result.status,
    'applied',
    'An older copied-from default must not cause a false inherited-value review'
  );
});

test('v1 development snapshots and carriers fail clearly without migration', () => {
  assert.throws(
    () => createBuildingPlanSession({ snapshot: { version: 1, unit: 'm', floors: [] } }),
    /version 2|not migrated/
  );
  const f = fixture();
  f.add({ x: 0, y: 0, width: 6, height: 3 });
  const record = writeBuildingPlanRecord({ meta: f.meta, plan: f.session.getSnapshot() });
  const node = f.meta.repeatablesByNodeKey.floors,
    row = record.repeatable[node.preferredKey][0],
    storage = node.fields.find((field) => field.binding?.role === 'storage');
  row.values[storage.dataName] = JSON.stringify({ version: 1, id: f.floorId });
  assert.throws(() => readBuildingPlanRecord({ meta: f.meta, record }), /not migrated/);
});

test('a field draft waits for valid completion; unchanged and invalid blur leave geometry alone', () => {
  const f = fixture();
  f.add({ x: 0, y: 0, width: 6, height: 3 });
  const record = writeBuildingPlanRecord({ meta: f.meta, plan: f.session.getSnapshot() });
  const editor = createBuildingPlanEditor({ meta: f.meta, record });
  let row = record,
    path = [];
  for (const name of ['floors', 'rooms', 'walls']) {
    const key = f.meta.repeatablesByNodeKey[name].preferredKey;
    row = row.repeatable[key][0];
    path.push({ key, id: row.id });
  }
  const open = editor.openRow({ path });
  const field =
    f.meta.repeatablesByNodeKey.walls.fieldsByOriginalDataName.wall_thickness_m.dataName;
  const before = editor.getSnapshot();
  assert.equal(
    editor.completeRow(open.scopeId, open.row, { fieldName: field }).status,
    'unchanged'
  );
  const edited = structuredClone(open.row);
  edited.values[field] = 0.4;
  assert.equal(editor.completeRow(open.scopeId, edited).status, 'draft');
  assert.deepEqual(editor.getSnapshot(), before);
  assert.equal(editor.completeRow(open.scopeId, edited, { fieldName: field }).status, 'applied');
  assert.equal(editor.cancelRow(open.scopeId).status, 'cancelled');
  assert.deepEqual(editor.getSnapshot(), before);
});

test('nearest explicit providers remain live and preserve explicit empty intent', () => {
  const provider = (name) =>
    textField(name, {
      visible: false,
      building_plan: { property: 'inspection_note', inherit_to: 'columns' },
    });
  const f = fixture({
    floors: { extra_elements: [provider('floor_note')] },
    rooms: { extra_elements: [provider('room_note')] },
  });
  const roomId = f.add({ x: 0, y: 0, width: 6, height: 3 });
  f.apply({
    type: 'set_provider',
    floorId: f.floorId,
    nodeKey: 'floors',
    property: 'inspection_note',
    fieldName: 'floor_note',
    value: 'floor',
  });
  const elementId = f.apply({
    type: 'create_element',
    floorId: f.floorId,
    roomId,
    collection: 'columns',
    element: { position: { x: 2, y: 2 }, width: 0.3, height: 0.3 },
  }).created.id;
  const column = () => f.floor().rooms[0].columns[0];
  assert.equal(column().properties.inspection_note, 'floor');
  f.apply({
    type: 'set_provider',
    floorId: f.floorId,
    roomId,
    elementId: roomId,
    nodeKey: 'rooms',
    property: 'inspection_note',
    fieldName: 'room_note',
    value: '',
  });
  assert.equal(column().properties.inspection_note, '');
  f.apply({
    type: 'set_property',
    floorId: f.floorId,
    nodeKey: 'columns',
    roomId,
    elementId,
    scope: 'node',
    property: 'inspection_note',
    value: 'override',
  });
  assert.equal(column().properties.inspection_note, 'override');
  f.apply({
    type: 'set_property',
    floorId: f.floorId,
    nodeKey: 'columns',
    roomId,
    elementId,
    scope: 'node',
    property: 'inspection_note',
    reset: true,
  });
  assert.equal(column().properties.inspection_note, '');
  const record = writeBuildingPlanRecord({ meta: f.meta, plan: f.session.getSnapshot() });
  assert.equal(
    readBuildingPlanRecord({ meta: f.meta, record }).floors[0].rooms[0].columns[0].properties
      .inspection_note,
    ''
  );
});

test('incompatible room providers require a canonical shared resolution', () => {
  const f = fixture({
    rooms: {
      extra_elements: [
        numericField('thickness_default', {
          building_plan: {
            property: 'wall_thickness_m',
            scope: 'physical_wall',
            inherit_to: 'walls',
          },
        }),
      ],
    },
  });
  const operation = adjacent(f);
  f.apply(operation);
  const rooms = f.floor().rooms;
  f.apply({
    type: 'set_provider',
    floorId: f.floorId,
    nodeKey: 'rooms',
    roomId: rooms[0].id,
    property: 'wall_thickness_m',
    fieldName: 'thickness_default',
    value: 0.2,
  });
  const pending = f.session.apply({
    type: 'set_provider',
    floorId: f.floorId,
    nodeKey: 'rooms',
    roomId: rooms[1].id,
    property: 'wall_thickness_m',
    fieldName: 'thickness_default',
    value: 0.25,
  });
  assert.equal(pending.status, 'pending', JSON.stringify(pending.issues));
  const accepted = answer(f, pending, 'candidate:0');
  assert.equal(accepted.status, 'applied', JSON.stringify(accepted.issues));
  const wall = f.floor().walls.find((entry) => entry.exposure === 'interior');
  assert.equal(wall.overrides.wall_thickness_m, 0.2);
});

test('custom collections copy only after confirmation, with new row identities on new owners', () => {
  const rows = repeatableSection('inspections', [textField('comment')]);
  rows.building_plan = { scope: 'physical_wall' };
  const f = fixture({ walls: { extra_elements: [rows] } });
  f.add({ x: 0, y: 0, width: 6, height: 3 });
  const face = f.floor().rooms[0].faces[0];
  f.apply({
    type: 'set_custom_rows',
    floorId: f.floorId,
    wallId: face.wallId,
    scope: 'physical_wall',
    repeatable: {
      inspections: [{ id: 'inspection-original', values: { comment: 'survey' }, repeatable: {} }],
    },
  });
  const before = f.session.getSnapshot();
  const pending = f.session.apply({
    type: 'split_face',
    floorId: f.floorId,
    faceId: face.id,
    offset: 2,
  });
  assert.equal(pending.status, 'pending', JSON.stringify(pending.issues));
  assert.deepEqual(f.session.getSnapshot(), before);
  assert.equal(answer(f, pending).status, 'applied');
  const copied = f.floor().walls.flatMap((wall) => wall.repeatable?.inspections || []);
  assert.equal(copied.length, 2);
  assert.equal(new Set(copied.map((row) => row.id)).size, 2);
  assert.ok(copied.every((row) => row.values.comment === 'survey'));
  const record = writeBuildingPlanRecord({ meta: f.meta, plan: f.session.getSnapshot() });
  const restored = readBuildingPlanRecord({ meta: f.meta, record });
  assert.equal(
    restored.floors[0].walls.flatMap((wall) => wall.repeatable?.inspections || []).length,
    2
  );
});

test('surface calculations use the canonical covering room; outside sides have no viewer room', async () => {
  const finish = calculatedField('surface_note', '$room_note');
  finish.building_plan = { scope: 'wall_face' };
  const f = fixture({
    rooms: { extra_elements: [textField('room_note')] },
    walls: { extra_elements: [finish] },
  });
  const roomId = f.add({ x: 0, y: 0, width: 6, height: 3 });
  f.apply({ type: 'set_values', floorId: f.floorId, roomId, values: { room_note: 'inside' } });
  const record = writeBuildingPlanRecord({ meta: f.meta, plan: f.session.getSnapshot() });
  const result = await createRecordEvaluator({ schema: f.expanded }).evaluate(record, {
    mode: 'refresh',
  });
  const nodes = f.meta.repeatablesByNodeKey,
    floorRow = result.snapshot.repeatable[nodes.floors.preferredKey][0];
  const sides =
    floorRow.repeatable[nodes.physical_walls.preferredKey][0].repeatable[
      nodes.wall_sides.preferredKey
    ];
  const model = nodes.wall_sides.fields.find((entry) => entry.binding?.role === 'storage').dataName;
  const output = nodes.wall_sides.fieldsByOriginalDataName.surface_note.dataName;
  assert.equal(
    sides.find((row) => JSON.parse(row.values[model]).roomId === roomId).values[output],
    'inside'
  );
  assert.equal(
    sides.find((row) => JSON.parse(row.values[model]).roomId == null).values[output],
    null
  );
});

test('Rejoin survives serialization and Undo restores deliberate owner boundaries', () => {
  const f = fixture();
  f.add({ x: 0, y: 0, width: 6, height: 3 });
  const face = f.floor().rooms[0].faces[0];
  const cut = f.apply({ type: 'split_face', floorId: f.floorId, faceId: face.id, offset: 2 })
    .created.id;
  const record = writeBuildingPlanRecord({ meta: f.meta, plan: f.session.getSnapshot() });
  const restored = readBuildingPlanRecord({ meta: f.meta, record });
  const session = createBuildingPlanSession({ snapshot: restored, properties: f.meta.properties });
  const joined = session.apply({ type: 'rejoin_cut', floorId: f.floorId, cutId: cut });
  assert.equal(joined.status, 'applied', JSON.stringify(joined.issues));
  assert.equal(session.getSnapshot().floors[0].walls.length, 4);
  assert.equal(session.undo().status, 'undone');
  assert.deepEqual(session.getSnapshot(), restored);
});

test('a required adjacency division through an opening preserves accepted data pending recovery', () => {
  const f = fixture();
  f.add({ x: 0, y: 0, width: 6, height: 3 });
  let floor = f.floor();
  const reference = floor.rooms[0].faces[2];
  f.apply({
    type: 'create_opening',
    floorId: f.floorId,
    wallId: reference.wallId,
    kind: 'door',
    offset: 1.5,
    width: 1,
    height: 2,
  });
  f.add({ x: 2, y: 3.2, width: 2, height: 3 });
  floor = f.floor();
  const before = f.session.getSnapshot();
  const result = f.session.apply({
    type: 'bind_faces',
    floorId: f.floorId,
    referenceFaceId: reference.id,
    faceId: floor.rooms[1].faces[0].id,
  });
  assert.equal(result.status, 'conflict');
  assert.equal(result.issues[0].code, 'opening_cut_requires_confirmation');
  assert.deepEqual(f.session.getSnapshot(), before);
  const confirmed = f.session.apply({
    type: 'bind_faces',
    floorId: f.floorId,
    referenceFaceId: reference.id,
    faceId: floor.rooms[1].faces[0].id,
    removeOpeningIds: result.issues[0].openingIds,
  });
  assert.equal(confirmed.status, 'applied', JSON.stringify(confirmed.issues));
  assert.equal(f.floor().walls.flatMap((wall) => wall.doors).length, 0);
});

test('wall providers reach one opening control without duplicated definitions', () => {
  const f = fixture({
    walls: {
      extra_elements: [
        textField('rating', {
          building_plan: { scope: 'physical_wall', property: 'fire_rating', inherit_to: 'doors' },
        }),
      ],
    },
  });
  f.add({ x: 0, y: 0, width: 6, height: 3 });
  const wall = f.floor().walls[0];
  f.apply({
    type: 'set_property',
    floorId: f.floorId,
    wallId: wall.id,
    property: 'fire_rating',
    value: 'R60',
  });
  f.apply({
    type: 'create_opening',
    floorId: f.floorId,
    wallId: wall.id,
    kind: 'door',
    offset: 1,
    width: 0.9,
    height: 2,
  });
  assert.equal(f.floor().walls[0].doors[0].properties.fire_rating, 'R60');
  assert.equal(
    f.meta.repeatablesByNodeKey.doors.fields.filter(
      (field) => field.binding?.property === 'fire_rating'
    ).length,
    1
  );
});

for (const value of ['apply', 'preserve', 'cancel'])
  test(`standalone canvas resolves ${value} before writing a topology candidate`, async () => {
    const { f, operation } = transition();
    let record = writeBuildingPlanRecord({ meta: f.meta, plan: f.session.getSnapshot() });
    const before = structuredClone(record);
    let writes = 0,
      questions = 0;
    const controller = new BuildingPlanCanvasController({
      meta: f.meta,
      editingPolicy: { inheritedChangePolicy: 'ask' },
      readRecord: () => record,
      writeRecord: (next) => {
        writes++;
        record = next;
      },
      presentQuestion: async () => {
        questions++;
        assert.deepEqual(record, before);
        return { value };
      },
    });
    await controller.apply(operation);
    assert.equal(questions, 1);
    assert.equal(writes, value === 'cancel' ? 0 : 1);
    if (value === 'cancel') assert.deepEqual(record, before);
    else
      assert.equal(
        readBuildingPlanRecord({ meta: f.meta, record }).floors[0].walls.find(
          (wall) => wall.exposure === 'interior'
        ).properties.wall_thickness_m,
        value === 'apply' ? 0.2 : 0.4
      );
    controller.dispose();
  });

test('source applicability controls live routing independently of visibility', () => {
  const f = fixture({
    floors: {
      extra_elements: [
        textField('enabled'),
        numericField('density_default', {
          visible: false,
          building_plan: {
            property: 'density',
            scope: 'physical_wall',
            inherit_to: 'walls',
            applies_to: { conditions: { field_id: 'enabled', operator: 'equal_to', value: 'yes' } },
          },
        }),
      ],
    },
  });
  f.apply({
    type: 'set_values',
    floorId: f.floorId,
    values: { enabled: 'yes', density_default: 5 },
  });
  f.add({ x: 0, y: 0, width: 5, height: 3 });
  assert.ok(f.floor().walls.every((wall) => wall.properties.density === 5));
  f.apply({ type: 'set_values', floorId: f.floorId, values: { enabled: 'no' } });
  assert.ok(f.floor().walls.every((wall) => wall.properties.density === null));
  assert.throws(
    () =>
      fixture({
        floors: {
          extra_elements: [
            numericField('bad', {
              building_plan: {
                inherit_to: 'walls',
                applies_to: {
                  conditions: { field_id: 'a_room_value', operator: 'equal_to', value: 1 },
                },
              },
            }),
          ],
        },
      }),
    /source|context/
  );
});

test('generated custom controls can be placed in a nested authored inline Section', () => {
  const section = (name, elements) => ({
    type: 'Section',
    key: name,
    data_name: name,
    label: name,
    display: 'inline',
    description: null,
    description_mode: null,
    visible: true,
    visible_conditions: null,
    elements,
  });
  const f = fixture({
    floors: {
      extra_elements: [
        numericField('rating_default', {
          building_plan: { property: 'rating', inherit_to: 'rooms' },
        }),
      ],
    },
    rooms: {
      extra_elements: [section('outer', [section('details', [textField('note')])])],
      property_overrides: { rating: { section_key: 'details', order: 0, label: 'Room rating' } },
    },
  });
  const rooms = f.meta.repeatablesByNodeKey.rooms;
  const control = rooms.fieldsByOriginalDataName.rating;
  assert.equal(control.field.label, 'Room rating');
  const find = (fields) =>
    fields.find((field) => field.label === 'details') ||
    fields
      .flatMap((field) => field.elements || [])
      .map((field) => find([field]))
      .find(Boolean);
  const generated = f.expanded.form.elements[0].elements[0];
  const details = find(generated.elements);
  assert.equal(details.elements[0].data_name, control.dataName);
  assert.ok(!JSON.stringify(f.schema).includes(control.dataName));
});

test('one authored inline Section can organize custom physical and surface questions together', () => {
  const f = fixture({
    walls: {
      extra_elements: [
        {
          type: 'Section',
          key: 'survey',
          data_name: 'survey',
          label: 'Survey',
          display: 'inline',
          description: null,
          description_mode: null,
          visible: true,
          visible_conditions: null,
          elements: [
            textField('material', { building_plan: { scope: 'physical_wall' } }),
            textField('finish', { building_plan: { scope: 'wall_face' } }),
          ],
        },
      ],
    },
  });
  const node = f.meta.repeatablesByNodeKey.walls;
  assert.equal(node.fieldsByOriginalDataName.material.binding.scope, 'physical_wall');
  assert.equal(node.fieldsByOriginalDataName.finish.binding.scope, 'wall_face');
  const physical = f.meta.repeatablesByNodeKey.physical_walls;
  assert.ok(physical.fieldsByOriginalDataName.material);
  assert.equal(physical.fieldsByOriginalDataName.finish, undefined);
});

test('an unrelated topology edit compares each existing piece with its own accepted defaults', () => {
  const f = fixture();
  f.add({ x: 0, y: 0, width: 6, height: 3 });
  const wall = f.floor().walls[0];
  f.apply({
    type: 'split_face',
    floorId: f.floorId,
    faceId: f.floor().rooms[0].faces[0].id,
    offset: 3,
  });
  f.apply({
    type: 'set_property',
    floorId: f.floorId,
    wallId: wall.id,
    property: 'wall_thickness_m',
    value: 0.4,
  });
  const previous = new Map(
    f.floor().walls.map((wall) => [wall.id, wall.properties.wall_thickness_m])
  );
  f.add({ x: 20, y: 0, width: 4, height: 3 });
  for (const wall of f.floor().walls)
    if (previous.has(wall.id))
      assert.equal(wall.properties.wall_thickness_m, previous.get(wall.id));
});

test('both surfaces of an internal partition in one room remain independently editable', () => {
  const f = fixture({
    walls: {
      extra_elements: [
        textField('finish', { building_plan: { scope: 'wall_face', on_split: 'copy' } }),
      ],
    },
  });
  const roomId = f.add({ x: 0, y: 0, width: 6, height: 4 });
  const wallId = f.apply({
    type: 'create_wall',
    floorId: f.floorId,
    roomId,
    vertices: [
      { x: 1, y: 2 },
      { x: 5, y: 2 },
    ],
  }).created.id;
  const record = writeBuildingPlanRecord({ meta: f.meta, plan: f.session.getSnapshot() }),
    nodes = f.meta.repeatablesByNodeKey;
  const index = f.floor().rooms[0].faces.findIndex((face) => face.wallId === wallId);
  const path = [
    { key: nodes.floors.preferredKey, index: 0 },
    { key: nodes.rooms.preferredKey, index: 0 },
    { key: nodes.walls.preferredKey, index },
  ];
  const editor = createBuildingPlanEditor({ meta: f.meta, record });
  const opened = editor.openRow({ path, scopeId: 'partition' });
  const front = nodes.walls.fieldsByOriginalDataName.finish.dataName,
    back = nodes.walls.fieldsByOriginalDataName.finish_outside.dataName;
  const row = structuredClone(opened.row);
  row.values[front] = 'Front';
  row.values[back] = 'Back';
  const result = editor.updateRow('partition', row);
  assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  const wall = editor.getSnapshot().floors[0].walls.find((wall) => wall.id === wallId);
  assert.equal(wall.exposure, 'interior');
  assert.ok(wall.sides.every((side) => side.roomId === roomId));
  assert.deepEqual(wall.sides.map((side) => side.overrides.finish).sort(), ['Back', 'Front']);
  const state = editor.fieldState(path, back);
  assert.equal(state.outside, false);
  assert.equal(state.opposite, true);
  assert.equal(state.applicable, true);
  assert.notEqual(editor.fieldState(path, front).subjectId, state.subjectId);
  assert.deepEqual(
    readBuildingPlanRecord({ meta: f.meta, record: editor.getRecord() }),
    editor.getSnapshot()
  );
});

test('automatic retirement preserves independent physical and surface provider intent', () => {
  for (const scope of ['physical_wall', 'wall_face']) {
    const f = fixture();
    f.add({ x: 0, y: 0, width: 6, height: 4 });
    const floor = f.floor(),
      survivor = floor.walls[0],
      retiring = structuredClone(survivor);
    retiring.id = 'retiring';
    retiring.segments = [];
    retiring.lineage = { automaticDivision: 'adjacency', splitFromWallId: survivor.id };
    for (const side of retiring.sides) side.id = `retiring-${side.sign}`;
    const acceptedSource = scope === 'physical_wall' ? survivor : survivor.sides[0];
    const retiringSource = scope === 'physical_wall' ? retiring : retiring.sides[0];
    acceptedSource.providerOverrides = { opening_rating: 'A' };
    retiringSource.providerOverrides = { opening_rating: null };
    floor.walls.push(retiring);
    let serial = 0;
    assert.throws(
      () => normalizePhysicalPieces(floor, () => `retirement-${++serial}`),
      (error) => error.issues?.[0]?.code === 'wall_retirement_conflict',
      `${scope} explicit unknown must not disappear into a differently answered survivor`
    );
    assert.ok(floor.walls.includes(retiring));
    assert.equal(retiringSource.providerOverrides.opening_rating, null);
  }
});

test('merging corresponding surfaces preserves explicit provider intent and rejects answer loss', () => {
  const f = fixture();
  f.add({ x: 0, y: 0, width: 6, height: 4 });
  const original = f.floor().walls[0];
  const target = structuredClone(original),
    source = structuredClone(original);
  source.sides[0].providerOverrides = { opening_rating: null };
  source.sides[0].values.finish = 'Lime';
  mergeWallSides(target, source, 1);
  assert.equal(target.sides[0].providerOverrides.opening_rating, null);
  assert.equal(target.sides[0].values.finish, 'Lime');
  for (const key of ['providerOverrides', 'values']) {
    const conflicting = structuredClone(source);
    conflicting.sides[0][key] = { ...conflicting.sides[0][key], finish: 'Paint' };
    target.sides[0][key].finish = 'Lime';
    assert.throws(
      () => mergeWallSides(target, conflicting, 1),
      (error) => error.issues?.[0]?.code === 'conflicting_surface_answers'
    );
    assert.equal(target.sides[0][key].finish, 'Lime');
  }
});
