import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELD_SPECS,
  BuildingPlanCanvasController,
  buildDatasetDescriptors,
  buildFormRecordSnapshot,
  createBuildingPlanSession,
  createBuildingPlanRecordSession,
  createBuildingPlanEditor,
  createRecordEvaluator,
  createStructuredRecord,
  expandBuildingPlanSchema,
  isBuildingPlanInternalCollection,
  readBuildingPlanRecord,
  writeBuildingPlanRecord,
} from '../src/index.js';
import { scopeBuildingPlanExpression } from '../src/schema/building-plan-expressions.js';

function field(type, name, extra = {}) {
  const result = {};
  for (const [key, definition] of Object.entries(FIELD_SPECS[type].attributes)) {
    if (!definition.required) continue;
    result[key] =
      definition.value ??
      (definition.nullable
        ? null
        : (definition.allowedValues?.[0] ??
          { string: '', boolean: false, array: [], object: {}, number: 0 }[definition.type]));
  }
  return {
    ...result,
    type,
    key: name,
    data_name: name,
    label: name,
    ...(FIELD_SPECS[type].attributes.display?.type === 'string' ? { display: 'default' } : {}),
    visible: true,
    ...(type === 'NumericField' ? { format: 'float' } : {}),
    ...extra,
  };
}

function fixture(custom = {}) {
  const schema = {
    form: {
      name: 'Shared building',
      elements: [
        field('TextField', 'unrelated'),
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
          node_overrides: custom,
        },
      ],
    },
  };
  const expanded = expandBuildingPlanSchema(schema);
  const meta = expanded.buildingPlanMeta[0];
  let serial = 0;
  const session = createBuildingPlanSession({
    properties: meta.properties,
    createId: () => `subject-${++serial}`,
  });
  const apply = (operation) => {
    const result = session.apply(operation);
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    return result;
  };
  const floorId = apply({
    type: 'create_floor',
    values: { floor_elevation_m: 0, floor_height_m: 3 },
  }).created.id;
  const a = apply({ type: 'create_room', floorId, rectangle: { x: 0, y: 0, width: 5, height: 3 } })
    .created.id;
  const b = apply({
    type: 'create_room',
    floorId,
    rectangle: { x: 3, y: 3.2, width: 5, height: 3 },
  }).created.id;
  const floor = session.getSnapshot().floors[0];
  const faceA = floor.rooms.find((room) => room.id === a).faces[2].id;
  const faceB = floor.rooms.find((room) => room.id === b).faces[0].id;
  apply({ type: 'bind_faces', floorId, referenceFaceId: faceA, faceId: faceB });
  return { schema, expanded: expanded.schema, meta, session, apply, floorId, a, b, faceA, faceB };
}

test('editors keep canonical collections internal and expose observation questions only by opt-in', () => {
  for (const observations of [false, true]) {
    const f = fixture(
      observations
        ? {
            walls: {
              extra_elements: [field('NumericField', 'measured_thickness')],
              field_bindings: { measured_thickness: { scope: 'observation' } },
            },
          }
        : {}
    );
    const nodes = f.meta.repeatablesByNodeKey;
    const internal = (name) => isBuildingPlanInternalCollection(f.meta, nodes[name].dataName);
    assert.equal(internal('physical_walls'), true);
    assert.equal(internal('observations'), true);
    assert.equal(internal('face_observations'), !observations);
    for (const name of [
      'floors',
      'rooms',
      'walls',
      'columns',
      'beams',
      'objects',
      'face_doors',
      'face_windows',
    ])
      assert.equal(internal(name), false, name);
    assert.equal(isBuildingPlanInternalCollection(f.meta, 'ordinary_repeatable'), false);
    assert.equal(isBuildingPlanInternalCollection(null, nodes.rooms.dataName), false);
    f.apply({
      type: 'add_observation',
      floorId: f.floorId,
      subject: { type: 'room_face', id: f.faceA },
      observedAt: '2026-11-03',
      values: { measured_thickness: 0.19 },
    });
    const record = writeBuildingPlanRecord({ meta: f.meta, plan: f.session.getSnapshot() });
    const stored = createStructuredRecord(record, f.expanded.form.elements, {
      originalElements: f.expanded.form.elements,
      fieldKeyMode: 'prefer-key',
    });
    const restored = readBuildingPlanRecord({
      meta: f.meta,
      record: buildFormRecordSnapshot(f.expanded, stored),
    });
    assert.equal(restored.floors[0].walls.length, 7);
    assert.equal(restored.floors[0].observations.length, 1);
    assert.equal(restored.floors[0].observations[0].observedAt, '2026-11-03');
    if (observations)
      assert.equal(restored.floors[0].observations[0].values.measured_thickness, 0.19);
  }
});

test('canonical records own physical walls once and omit projected field/child copies', () => {
  const f = fixture();
  const plan = f.session.getSnapshot();
  const sharedWall = plan.floors[0].rooms[0].faces[2].wallId;
  f.apply({
    type: 'create_opening',
    floorId: f.floorId,
    wallId: sharedWall,
    kind: 'door',
    offset: 4,
    width: 0.9,
    height: 2.1,
  });
  let rowSerial = 0;
  const record = writeBuildingPlanRecord({
    meta: f.meta,
    plan: f.session.getSnapshot(),
    record: { values: { unrelated: 'Keep' }, repeatable: {}, host: 'metadata' },
    createRowId: () => `row-${++rowSerial}`,
  });
  const nodes = f.meta.repeatablesByNodeKey;
  const floor = record.repeatable[nodes.floors.key][0];
  assert.equal(floor.repeatable[nodes.physical_walls.key].length, 7);
  const roomFaces = floor.repeatable[nodes.rooms.key].flatMap(
    (room) => room.repeatable[nodes.walls.key]
  );
  assert.equal(
    roomFaces.reduce((sum, face) => sum + face.repeatable[nodes.face_doors.key].length, 0),
    2
  );
  for (const mode of ['prefer-key', 'data-name']) {
    const stored = createStructuredRecord(record, f.expanded.form.elements, {
      originalElements: f.expanded.form.elements,
      fieldKeyMode: mode,
    });
    const restored = buildFormRecordSnapshot(f.expanded, stored);
    const model = readBuildingPlanRecord({ meta: f.meta, record: restored });
    assert.equal(model.floors[0].walls.length, 7);
    assert.equal(model.floors[0].walls.flatMap((wall) => wall.doors).length, 1);
    assert.equal(model.floors[0].walls.find((wall) => wall.id === sharedWall).doors[0].offset, 4);
    const storedText = JSON.stringify(stored);
    for (const node of ['face_doors', 'face_windows', 'face_observations'])
      assert.ok(
        !storedText.includes(mode === 'data-name' ? nodes[node].dataName : nodes[node].key)
      );
    assert.equal(restored.raw_values.unrelated, 'Keep');
  }
  assert.equal(record.host, 'metadata');
  assert.notEqual(floor.id, f.floorId);
});

test('custom wall questions keep face, physical and observation ownership through round trips', () => {
  const f = fixture({
    walls: {
      extra_elements: [
        field('TextField', 'paint', { default_value: 'White' }),
        field('NumericField', 'insulation'),
        field('TextField', 'finding'),
      ],
      field_bindings: {
        insulation: { scope: 'physical_wall', inherit: true },
        finding: { scope: 'observation' },
      },
    },
  });
  const wallId = f.session.getSnapshot().floors[0].rooms[0].faces[2].wallId;
  f.apply({ type: 'set_defaults', floorId: f.floorId, property: 'insulation', value: 0.05 });
  f.apply({
    type: 'set_property',
    floorId: f.floorId,
    faceId: f.faceA,
    property: 'paint',
    value: 'Cream',
  });
  f.apply({
    type: 'add_observation',
    floorId: f.floorId,
    subject: { type: 'room_face', id: f.faceB },
    observedAt: '2026-11-02',
    values: { finding: 'Cracks' },
    coverage: { length: 2 },
    evidence: ['photo'],
  });
  const record = writeBuildingPlanRecord({ meta: f.meta, plan: f.session.getSnapshot() });
  const stored = createStructuredRecord(record, f.expanded.form.elements, {
    originalElements: f.expanded.form.elements,
  });
  const model = readBuildingPlanRecord({
    meta: f.meta,
    record: buildFormRecordSnapshot(f.expanded, stored),
  });
  assert.equal(
    model.floors[0].walls.find((wall) => wall.id === wallId).properties.insulation,
    0.05
  );
  assert.equal(model.floors[0].rooms[0].faces[2].properties.paint, 'Cream');
  assert.equal(model.floors[0].rooms[1].faces[0].properties.paint, 'White');
  assert.deepEqual(model.floors[0].observations[0].values, { finding: 'Cracks' });
  assert.deepEqual(model.floors[0].observations[0].evidence, ['photo']);
  assert.ok(
    buildDatasetDescriptors(f.expanded).every(
      (dataset) =>
        !['face_doors', 'face_windows', 'face_observations'].some(
          (node) => dataset.repeatable_field_id === f.meta.repeatablesByNodeKey[node].key
        )
    )
  );
});

test('canonical row identities, metadata and unrelated answers survive model writes', () => {
  const f = fixture();
  const first = writeBuildingPlanRecord({ meta: f.meta, plan: f.session.getSnapshot() });
  const key = f.meta.repeatablesByNodeKey.floors.key;
  first.repeatable[key][0].created_at_client = '2026-11-01T00:00:00Z';
  first.repeatable[key][0].hostMetadata = 'Keep';
  first.values.note = 'Unrelated';
  const next = writeBuildingPlanRecord({
    meta: f.meta,
    plan: readBuildingPlanRecord({ meta: f.meta, record: first }),
    record: first,
  });
  assert.equal(next.repeatable[key][0].id, first.repeatable[key][0].id);
  assert.equal(
    next.repeatable[key][0].created_at_client,
    first.repeatable[key][0].created_at_client
  );
  assert.equal(next.repeatable[key][0].hostMetadata, 'Keep');
  assert.equal(next.values.note, 'Unrelated');
  assert.equal(first.repeatable[key][0].hostMetadata, 'Keep');
});

test('scoped physical calculations execute once per physical wall and feed face calculations', async () => {
  const f = fixture({
    walls: {
      extra_elements: [
        field('CalculatedField', 'wall_cost', {
          calculate: 'SETRESULT(count($wall_thickness_m) * 1000);',
        }),
        field('CalculatedField', 'face_cost', { calculate: 'SETRESULT($wall_cost + 1);' }),
      ],
      field_bindings: { wall_cost: { scope: 'physical_wall' } },
    },
  });
  const record = writeBuildingPlanRecord({ meta: f.meta, plan: f.session.getSnapshot() });
  let calls = 0;
  const evaluator = createRecordEvaluator({
    schema: f.schema,
    helpers: {
      count: (value) => {
        calls++;
        return value;
      },
    },
    diagnostics: { console: false },
  });
  const evaluated = await evaluator.evaluate(record, { mode: 'refresh' });
  assert.equal(evaluated.status, 'evaluated', JSON.stringify(evaluated.issues));
  assert.equal(calls, 7);
  const nodes = f.meta.repeatablesByNodeKey;
  const faceField = nodes.walls.fieldsByOriginalDataName.face_cost.dataName;
  const wallField = nodes.walls.fieldsByOriginalDataName.wall_cost.dataName;
  const floor = evaluated.snapshot.repeatable[nodes.floors.key][0];
  for (const room of floor.repeatable[nodes.rooms.key])
    for (const face of room.repeatable[nodes.walls.key]) {
      assert.equal(face.values[wallField], 200);
      assert.equal(face.values[faceField], 201);
    }
});

for (const security of ['trusted', 'safe'])
  test(`portion thickness feeds ordinary calculations, conditions and readonly fields (${security})`, async () => {
    const f = fixture({
      walls: {
        extra_elements: [
          field('CalculatedField', 'span_cost', {
            calculate: 'SETRESULT($wall_thickness_m * 1000);',
          }),
          field('TextField', 'thick_note', {
            visible: false,
            visible_conditions: {
              field_id: 'bp_wall_thickness_m',
              operator: 'greater_than',
              value: 0.3,
            },
            required_conditions: {
              field_id: 'bp_wall_thickness_m',
              operator: 'greater_than',
              value: 0.3,
            },
          }),
        ],
      },
    });
    f.apply({ type: 'split_face', floorId: f.floorId, faceId: f.faceB, offset: 2 });
    const wallId = f.session
      .getSnapshot()
      .floors[0].rooms[1].faces.find((face) => face.id === f.faceB).wallId;
    const face = f.session
      .getSnapshot()
      .floors[0].rooms[1].faces.find((face) => face.wallId === wallId && face.id !== f.faceB);
    f.apply({
      type: 'set_property',
      floorId: f.floorId,
      faceId: face.id,
      property: 'wall_thickness_m',
      value: 0.4,
    });
    f.apply({
      type: 'set_defaults',
      floorId: f.floorId,
      property: 'wall_thickness_m',
      value: 0.25,
    });
    const nodes = f.meta.repeatablesByNodeKey;
    const thickness = nodes.walls.fieldsByOriginalDataName.wall_thickness_m.dataName;
    const cost = nodes.walls.fieldsByOriginalDataName.span_cost.dataName;
    const note = nodes.walls.fieldsByOriginalDataName.thick_note.dataName;
    const storage = nodes.walls.fields.find((field) => field.binding?.role === 'storage').dataName;
    const evaluator = createRecordEvaluator({
      schema: f.schema,
      security: { mode: security },
      diagnostics: { console: false },
    });
    const record = writeBuildingPlanRecord({ meta: f.meta, plan: f.session.getSnapshot() });
    const evaluated = await evaluator.evaluate(record, { mode: 'refresh' });
    assert.equal(evaluated.status, 'evaluated', JSON.stringify(evaluated.issues));
    const floor = evaluated.snapshot.repeatable[nodes.floors.preferredKey][0];
    const room = floor.repeatable[nodes.rooms.preferredKey][1];
    const rows = room.repeatable[nodes.walls.preferredKey];
    const index = rows.findIndex((row) => JSON.parse(row.values[storage]).id === face.id);
    assert.equal(rows[index].values[thickness], 0.4);
    assert.equal(rows[index].values[cost], 400);
    assert.equal(rows[index].visible[note], true);
    assert.equal(rows[index].required[note], true);
    const shared = rows.find((row) => JSON.parse(row.values[storage]).id === f.faceB);
    assert.equal(shared.values[thickness], 0.25);
    assert.equal(shared.values[cost], 250);
    assert.equal(shared.visible[note], false);
    const readonly = structuredClone(record);
    const selected =
      readonly.repeatable[nodes.floors.preferredKey][0].repeatable[nodes.rooms.preferredKey][1]
        .repeatable[nodes.walls.preferredKey][index];
    selected.read_only = { [thickness]: true };
    const managed = createBuildingPlanRecordSession({ meta: f.meta, record: readonly });
    const changed = structuredClone(selected);
    changed.values[thickness] = 0.5;
    const blocked = managed.applyRow({
      path: [
        { key: nodes.floors.preferredKey, index: 0 },
        { key: nodes.rooms.preferredKey, index: 1 },
        { key: nodes.walls.preferredKey, index },
      ],
      editedRow: changed,
    });
    assert.equal(blocked.status, 'conflict');
    assert.equal(blocked.issues[0].code, 'readonly_field');
    f.apply({
      type: 'set_property',
      floorId: f.floorId,
      faceId: face.id,
      property: 'wall_thickness_m',
      value: null,
    });
    const incomplete = await evaluator.prepareSubmission(
      writeBuildingPlanRecord({
        meta: f.meta,
        plan: f.session.getSnapshot(),
        record,
      })
    );
    assert.ok(
      incomplete.validationSummary.orderedIssues.some(
        (issue) =>
          issue.fieldName === thickness && issue.instancePath?.at(-1)?.instanceId === selected.id
      ),
      JSON.stringify(incomplete.validationSummary.orderedIssues)
    );
    f.apply({
      type: 'set_property',
      floorId: f.floorId,
      faceId: face.id,
      property: 'wall_thickness_m',
      reset: true,
    });
    f.apply({
      type: 'set_defaults',
      floorId: f.floorId,
      property: 'wall_thickness_m',
      value: null,
    });
    const inheritedUnknown = await evaluator.prepareSubmission(
      writeBuildingPlanRecord({
        meta: f.meta,
        plan: f.session.getSnapshot(),
        record,
      })
    );
    assert.equal(
      inheritedUnknown.validationSummary.orderedIssues.filter(
        (issue) => issue.fieldName === thickness
      ).length,
      7
    );
  });

test('scope rewriting preserves strings, comments and regular expressions', () => {
  const source =
    'SETRESULT($thickness + "$thickness".length + /\u0024thickness/.source.length); // $thickness';
  const scoped = scopeBuildingPlanExpression(source, new Map([['thickness', 'scoped_thickness']]));
  assert.ok(scoped.startsWith('SETRESULT($scoped_thickness + "$thickness"'));
  assert.ok(scoped.endsWith('// $thickness'));
  assert.ok(scoped.includes('/\u0024thickness/'));
});

test('scope rewriting preserves object keys, local bindings, and lexical shadowing', () => {
  const aliases = new Map([
    ['density', 'physical_density'],
    ['thickness', 'physical_thickness'],
  ]);
  assert.equal(
    scopeBuildingPlanExpression(
      'const result = { $density }; SETRESULT(result.$density + $density);',
      aliases
    ),
    'const result = { $density: $physical_density }; SETRESULT(result.$density + $physical_density);'
  );
  assert.equal(
    scopeBuildingPlanExpression(
      'SETRESULT((($thickness) => $thickness)(2) + $thickness);',
      aliases
    ),
    'SETRESULT((($thickness) => $thickness)(2) + $physical_thickness);'
  );
  assert.equal(
    scopeBuildingPlanExpression(
      'const { $density } = input; SETRESULT($density + $thickness);',
      aliases
    ),
    'const { $density } = input; SETRESULT($density + $physical_thickness);'
  );
});

test('invalid custom scope and observation inheritance fail authoring expansion', () => {
  assert.throws(
    () =>
      fixture({
        walls: {
          extra_elements: [field('TextField', 'finding')],
          field_bindings: { finding: { scope: 'observation', inherit: true } },
        },
      }),
    /cannot inherit/
  );
  assert.throws(
    () => fixture({ walls: { field_bindings: { absent: { scope: 'physical_wall' } } } }),
    /custom wall field/
  );
});

test('normal row edits write one canonical shared property and cancel sibling geometry with their editor', () => {
  const f = fixture();
  const record = writeBuildingPlanRecord({ meta: f.meta, plan: f.session.getSnapshot() });
  const session = createBuildingPlanRecordSession({ meta: f.meta, record });
  const initialRooms = session.getSnapshot().floors[0].rooms;
  const nodes = f.meta.repeatablesByNodeKey;
  const floor = session.getRecord().repeatable[nodes.floors.preferredKey][0];
  const room = floor.repeatable[nodes.rooms.preferredKey][0];
  const face = room.repeatable[nodes.walls.preferredKey][2];
  const path = [
    { key: nodes.floors.preferredKey, id: floor.id },
    { key: nodes.rooms.preferredKey, id: room.id },
    { key: nodes.walls.preferredKey, id: face.id },
  ];
  const floorScope = session.beginScope({ id: 'floor-editor' }).scopeId;
  session.apply(
    { type: 'set_values', floorId: f.floorId, values: { floor_name: 'Independent answer' } },
    { scopeId: floorScope }
  );
  const child = session.beginScope({ id: 'wall-editor', parentScopeId: floorScope }).scopeId;
  const edited = structuredClone(face);
  edited.values[nodes.walls.fieldsByOriginalDataName.wall_thickness_m.dataName] = 0.4;
  const result = session.applyRow({ path, editedRow: edited, initialRow: face, scopeId: child });
  assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  const after = session.getSnapshot().floors[0];
  const shared = after.walls.find((wall) => wall.id === after.rooms[0].faces[2].wallId);
  assert.equal(shared.properties.wall_thickness_m, 0.4);
  assert.equal(shared.provenance.wall_thickness_m.scope, 'physical_wall');
  assert.equal(session.cancelScope(child).status, 'cancelled');
  assert.equal(session.getSnapshot().floors[0].values.floor_name, 'Independent answer');
  assert.deepEqual(session.getSnapshot().floors[0].rooms, initialRooms);
});

test('shared canvas controller commits once, navigates by existing row path, and rejects invalid gestures', async () => {
  const f = fixture();
  let record = writeBuildingPlanRecord({ meta: f.meta, plan: f.session.getSnapshot() });
  let commits = 0;
  let selected;
  let issues;
  const controller = new BuildingPlanCanvasController({
    meta: f.meta,
    readRecord: () => record,
    writeRecord: (next) => {
      commits++;
      record = next;
    },
    focusRow: (path) => {
      selected = path;
    },
    reportIssues: (next) => {
      issues = next;
    },
  });
  const room = controller.getSnapshot().rooms[0];
  assert.equal(room.rect.width, 100);
  controller.focusRoom(room.id);
  assert.equal(selected.length, 2);
  assert.equal(selected[1].index, 0);
  const before = structuredClone(record);
  assert.equal(await controller.updateRoom(room.id, { ...room.rect, width: -10 }), null);
  assert.equal(commits, 0);
  assert.deepEqual(record, before);
  assert.ok(issues.length);
  controller.clearPreview();
  assert.ok(issues.length, 'Releasing an invalid gesture must leave its inline conflict visible.');
  controller.clearPreview({ clearIssues: true });
  assert.deepEqual(issues, []);
  await controller.updateRoom(room.id, { ...room.rect, x: -80 });
  assert.equal(commits, 1);
  assert.equal(controller.getSnapshot().rooms[0].rect.x, -80);
  assert.equal(issues.length, 0);
  controller.dispose();
});

test('pending canvas completion cannot accept a gesture after its host is disposed', async () => {
  const f = fixture();
  const record = writeBuildingPlanRecord({ meta: f.meta, plan: f.session.getSnapshot() });
  let finish;
  const controller = new BuildingPlanCanvasController({
    meta: f.meta,
    readRecord: () => record,
    writeRecord: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const before = controller.session.getSnapshot();
  const pending = controller.createRoom({ x: 400, y: 0, width: 100, height: 100 });
  assert.equal(controller.isBusy(), true);
  controller.dispose();
  finish(true);
  assert.equal(await pending, null);
  assert.deepEqual(controller.session.getSnapshot(), before);
});

test('standard new row drafts own their generated physical subjects until their parent accepts', () => {
  const f = fixture();
  const editor = createBuildingPlanEditor({ meta: f.meta, record: { values: {}, repeatable: {} } });
  const nodes = f.meta.repeatablesByNodeKey;
  const floorPath = [{ key: nodes.floors.preferredKey, id: 'floor-row' }];
  const floor = editor.openRow({
    path: floorPath,
    row: { id: 'floor-row', values: {}, repeatable: {} },
    scopeId: 'floor',
  });
  assert.equal(floor.status, 'opened');
  const roomPath = [...floorPath, { key: nodes.rooms.preferredKey, id: 'room-row' }];
  const room = editor.openRow({
    path: roomPath,
    row: { id: 'room-row', values: {}, repeatable: {} },
    scopeId: 'room',
    parentScopeId: 'floor',
  });
  assert.equal(room.status, 'opened');
  assert.equal(editor.getSnapshot().floors[0].walls.length, 4);
  const edited = structuredClone(room.row);
  edited.values[nodes.rooms.fieldsByOriginalDataName.room_name.dataName] = 'Kitchen';
  assert.equal(editor.updateRow('room', edited).status, 'applied');
  assert.equal(editor.acceptRow('room').status, 'accepted');
  assert.equal(editor.getSnapshot().floors[0].rooms[0].values.room_name.choice[0].value, 'Kitchen');
  assert.equal(editor.cancelRow('floor').status, 'cancelled');
  assert.deepEqual(editor.getSnapshot().floors, []);
});

test('late derived evaluation cannot replace newer parent-context results or accepted geometry', async () => {
  const f = fixture({
    walls: { extra_elements: [field('CalculatedField', 'score', { calculate: 'SETRESULT(1)' })] },
  });
  const editor = createBuildingPlanEditor({
    meta: f.meta,
    record: writeBuildingPlanRecord({ meta: f.meta, plan: f.session.getSnapshot() }),
  });
  const pending = [];
  const evaluator = {
    evaluate: (snapshot) => new Promise((resolve) => pending.push({ snapshot, resolve })),
  };
  const node = f.meta.repeatablesByNodeKey;
  const score = node.walls.fieldsByOriginalDataName.score.dataName;
  const finish = (entry, value) => {
    for (const floor of entry.snapshot.repeatable[node.floors.preferredKey])
      for (const room of floor.repeatable[node.rooms.preferredKey])
        for (const face of room.repeatable[node.walls.preferredKey]) face.values[score] = value;
    entry.resolve({ snapshot: entry.snapshot });
  };
  const old = editor.evaluate(evaluator, { factor: 1 });
  const fresh = editor.evaluate(evaluator, { factor: 2 });
  finish(pending[1], 2);
  assert.equal((await fresh).status, 'evaluated');
  finish(pending[0], 1);
  assert.equal((await old).status, 'stale');
  const savedFace =
    editor.getRecord().repeatable[node.floors.preferredKey][0].repeatable[
      node.rooms.preferredKey
    ][0].repeatable[node.walls.preferredKey][0];
  assert.equal(savedFace.values[score], 2);
  const geometryPending = editor.evaluate(evaluator, { factor: 3 });
  editor.apply({ type: 'move_room', floorId: f.floorId, roomId: f.b, delta: { x: 10, y: 0 } });
  finish(pending[2], 3);
  assert.equal((await geometryPending).status, 'stale');
});

test('uncaptured structural coordinates stay uncaptured through record round trips and canvas rendering', () => {
  const f = fixture();
  f.apply({
    type: 'create_element',
    floorId: f.floorId,
    roomId: f.a,
    collection: 'columns',
    element: { position: { x: 2, y: 1 }, width: 0.3, height: 0.3 },
  });
  const nodes = f.meta.repeatablesByNodeKey;
  const record = writeBuildingPlanRecord({ meta: f.meta, plan: f.session.getSnapshot() });
  const column =
    record.repeatable[nodes.floors.preferredKey][0].repeatable[nodes.rooms.preferredKey][0]
      .repeatable[nodes.columns.preferredKey][0];
  const u = nodes.columns.fieldsByOriginalDataName.column_center_u.dataName;
  const v = nodes.columns.fieldsByOriginalDataName.column_center_v.dataName;
  column.values[u] = null;
  const session = createBuildingPlanRecordSession({ meta: f.meta, record });
  const floorRow = record.repeatable[nodes.floors.preferredKey][0];
  const roomRow = floorRow.repeatable[nodes.rooms.preferredKey][0];
  const editedColumn = structuredClone(column);
  editedColumn.values[
    nodes.columns.fieldsByOriginalDataName.column_cross_section_width_m.dataName
  ] = 0.4;
  const result = session.applyRow({
    path: [
      { key: nodes.floors.preferredKey, id: floorRow.id },
      { key: nodes.rooms.preferredKey, id: roomRow.id },
      { key: nodes.columns.preferredKey, id: column.id },
    ],
    initialRow: column,
    editedRow: editedColumn,
  });
  assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  assert.equal(session.getSnapshot().floors[0].rooms[0].columns[0].position, null);
  column.values[u] = null;
  const capturedV = column.values[v];
  const plan = readBuildingPlanRecord({ meta: f.meta, record });
  assert.equal(plan.floors[0].rooms[0].columns[0].position, null);
  const roundTrip = writeBuildingPlanRecord({ meta: f.meta, plan, record });
  const stored =
    roundTrip.repeatable[nodes.floors.preferredKey][0].repeatable[nodes.rooms.preferredKey][0]
      .repeatable[nodes.columns.preferredKey][0];
  assert.equal(stored.values[u], null);
  assert.equal(stored.values[v], capturedV);
  const controller = new BuildingPlanCanvasController({
    meta: f.meta,
    readRecord: () => roundTrip,
  });
  assert.equal(controller.getSnapshot().columns.length, 0);
  controller.dispose();
});

test('inherited custom choices keep ordinary values, requiredness, and readonly write protection', async () => {
  const f = fixture({
    walls: {
      extra_elements: [
        field('SingleChoiceField', 'material', {
          choices: [
            { value: 'brick', label: 'Brick' },
            { value: 'stone', label: 'Stone' },
          ],
          default_value: 'brick',
          required: true,
        }),
      ],
      field_bindings: { material: { scope: 'physical_wall', inherit: true } },
    },
  });
  const record = writeBuildingPlanRecord({ meta: f.meta, plan: f.session.getSnapshot() });
  const nodes = f.meta.repeatablesByNodeKey;
  const floor = record.repeatable[nodes.floors.preferredKey][0];
  const path = [{ key: nodes.floors.preferredKey, id: floor.id }];
  const session = createBuildingPlanRecordSession({ meta: f.meta, record });
  const edited = structuredClone(floor);
  const defaultField = nodes.floors.fieldsByOriginalDataName.default_material.dataName;
  edited.values[defaultField] = 'stone';
  assert.equal(session.applyRow({ path, initialRow: floor, editedRow: edited }).status, 'applied');
  const evaluated = await createRecordEvaluator({
    schema: f.schema,
    diagnostics: { console: false },
  }).evaluate(session.getRecord());
  const physical =
    evaluated.snapshot.repeatable[nodes.floors.preferredKey][0].repeatable[
      nodes.physical_walls.preferredKey
    ][0];
  const material = nodes.physical_walls.fieldsByOriginalDataName.material.dataName;
  assert.deepEqual(physical.values[material], {
    choice: [{ value: 'stone', label: 'Stone' }],
    other: [],
  });
  assert.equal(physical.required[material], true);
  assert.equal(physical.errors[material], undefined);
  const readonlyRecord = session.getRecord();
  readonlyRecord.repeatable[nodes.floors.preferredKey][0].read_only = { [defaultField]: true };
  const readonly = createBuildingPlanRecordSession({ meta: f.meta, record: readonlyRecord });
  const blocked = structuredClone(readonlyRecord.repeatable[nodes.floors.preferredKey][0]);
  blocked.values[defaultField] = 'brick';
  const result = readonly.applyRow({ path, editedRow: blocked });
  assert.equal(result.status, 'conflict');
  assert.equal(result.issues[0].code, 'readonly_field');
});

test('physical requiredness produces one finding per wall that navigates to an ordinary facing row', async () => {
  const f = fixture();
  const record = writeBuildingPlanRecord({ meta: f.meta, plan: f.session.getSnapshot() });
  const result = await createRecordEvaluator({
    schema: f.schema,
    diagnostics: { console: false },
  }).prepareSubmission(record);
  const nodes = f.meta.repeatablesByNodeKey;
  const physicalHeight = nodes.physical_walls.fieldsByOriginalDataName.wall_height_m.dataName;
  const faceHeight = nodes.walls.fieldsByOriginalDataName.wall_height_m.dataName;
  const heightIssues = result.validationSummary.orderedIssues.filter(
    (issue) => issue.canonical?.fieldName === physicalHeight
  );
  assert.equal(heightIssues.length, 7);
  for (const issue of heightIssues) {
    assert.equal(issue.fieldName, faceHeight);
    assert.equal(issue.instancePath.at(-1).repeatableKey, nodes.walls.preferredKey);
    assert.equal(
      issue.canonical.instancePath.at(-1).repeatableKey,
      nodes.physical_walls.preferredKey
    );
  }
});
