import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBuildingPlanEditor,
  createFormEngine,
  expandBuildingPlanSchema,
  createBuildingPlanPresentation,
  createBuildingPlanSession,
  writeBuildingPlanRecord,
  readBuildingPlanRecord,
} from '../src/index.js';
import { validateFieldValue } from '../src/schema/field-value-registry.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import { buildingPlanBoundaryClearanceIssues } from '../src/building-plan/footprints.js';
import { at, segmentFrame, polygonArea } from '../src/building-plan/geometry.js';

const choice = (value, label = value) => ({ choice: [{ value, label }], other: [] });
function fixture() {
  const schema = {
    form: {
      name: 'Floors',
      measurement_system: 'si',
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
          node_overrides: {},
        },
      ],
    },
  };
  const expanded = expandBuildingPlanSchema(schema);
  const meta = expanded.buildingPlanMeta[0];
  const domain = createBuildingPlanSession({
    properties: meta.properties,
    editingPolicy: { inheritedChangePolicy: 'apply' },
  });
  const apply = (operation) => {
    const result = domain.apply(operation);
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    return result;
  };
  const floorId = apply({
    type: 'create_floor',
    values: {
      floor_name: choice('ground_floor'),
      floor_elevation: 0,
      floor_height: 3,
      floor_interior_wall_thickness: 0.2,
      floor_exterior_wall_thickness: 0.2,
      floor_interior_wall_plaster: choice('plastered'),
      floor_interior_wall_plaster_thickness: 0.015,
      floor_exterior_wall_plaster: choice('not_plastered'),
    },
  }).created.id;
  const roomId = apply({
    type: 'create_room',
    floorId,
    rectangle: { x: 0, y: 0, width: 6, height: 4 },
  }).created.id;
  const floor = () => domain.getSnapshot().floors[0];
  const provide = (name, property, value) =>
    apply({ type: 'set_provider', floorId, nodeKey: 'floors', fieldName: name, property, value });
  return { schema, expanded, meta, domain, apply, floorId, roomId, floor, provide };
}

test('floor system fields use protected conditional visibility, requiredness and integer bounds', () => {
  const f = fixture(),
    fields = f.meta.repeatablesByNodeKey.floors.fieldsByOriginalDataName;
  assert.deepEqual(
    f.meta.repeatablesByNodeKey.floors.fields.slice(0, 3).map((field) => field.originalDataName),
    ['floor_name', 'floor_upper_number', 'floor_basement_number']
  );
  const floorSections = f.expanded.schema.form.elements[0].elements[0].elements.filter(
    (field) => field.type === 'Section'
  );
  const engine = createFormEngine({
    schema: { form: { name: 'Floor row', elements: floorSections } },
  });
  const change = (name, value) => {
    engine.setValue(fields[name].dataName, value);
    engine.eval();
    return engine.getState();
  };
  let state = change('floor_name', choice('upper_floor'));
  assert.equal(state.required[fields.floor_upper_number.dataName], true);
  assert.equal(state.visible[fields.floor_basement_number.dataName], false);
  assert.ok(validateFieldValue(fields.floor_upper_number.field, 0));
  assert.ok(validateFieldValue(fields.floor_upper_number.field, 1.5));
  assert.equal(validateFieldValue(fields.floor_upper_number.field, 200), null);
  assert.ok(validateFieldValue(fields.floor_basement_number.field, 0));
  assert.equal(validateFieldValue(fields.floor_basement_number.field, -100), null);
  for (const name of ['land_survey', 'roof']) {
    state = change('floor_name', choice(name));
    for (const field of [
      'floor_height',
      'floor_interior_wall_thickness',
      'floor_exterior_wall_thickness',
    ]) {
      assert.equal(state.visible[fields[field].dataName], true);
      assert.equal(state.required[fields[field].dataName], false);
    }
    assert.equal(state.required[fields.floor_elevation.dataName], true);
  }
  state = change('floor_name', choice('ground_floor'));
  for (const name of [
    'floor_height',
    'floor_interior_wall_thickness',
    'floor_exterior_wall_thickness',
  ])
    assert.equal(state.required[fields[name].dataName], true);
  state = change('floor_interior_wall_plaster', null);
  assert.equal(state.visible[fields.floor_interior_wall_plaster_thickness.dataName], false);
  state = change('floor_interior_wall_plaster', choice('plastered'));
  assert.equal(state.required[fields.floor_interior_wall_plaster_thickness.dataName], true);
  assert.equal(state.visible[fields.floor_interior_wall_plaster_thickness.dataName], true);
});

for (const angle of [0, 0.37])
  for (const type of ['resize_face', 'create_room']) {
    test(`unequal floor thickness defaults reconcile new shared coverage during ${type} (${angle})`, () => {
      const f = createBuildingPlanExample();
      let session = createBuildingPlanSession({
        snapshot: f.snapshot,
        properties: f.meta.properties,
        editingPolicy: { inheritedChangePolicy: 'apply', copyCustomAnswersAutomatically: true },
      });
      const configured = session.apply({
        type: 'set_provider',
        floorId: f.floorId,
        nodeKey: 'floors',
        fieldName: 'floor_exterior_wall_thickness',
        property: 'wall_thickness_m',
        value: 0.5,
      });
      assert.equal(configured.status, 'applied', JSON.stringify(configured.issues));
      const rotate = ({ x, y, ...rest }) => ({
        ...rest,
        x: x * Math.cos(angle) - y * Math.sin(angle),
        y: x * Math.sin(angle) + y * Math.cos(angle),
      });
      if (angle) {
        const rotated = session.getSnapshot();
        for (const floor of rotated.floors) {
          for (const room of floor.rooms) room.vertices = room.vertices.map(rotate);
          for (const wall of floor.walls)
            for (const span of wall.segments) {
              span.start = rotate(span.start);
              span.end = rotate(span.end);
            }
        }
        session = createBuildingPlanSession({
          snapshot: rotated,
          properties: f.meta.properties,
          editingPolicy: { inheritedChangePolicy: 'apply', copyCustomAnswersAutomatically: true },
        });
      }
      const before = session.getSnapshot(),
        floor = before.floors[0];
      const selected = floor.rooms[0].faces.find(
        (face) => floor.walls.find((w) => w.id === face.wallId).autoLabel === 'W2'
      );
      const operation =
        type === 'resize_face'
          ? { type, floorId: f.floorId, faceId: selected.id, distance: 1 }
          : {
              type,
              floorId: f.floorId,
              vertices: [
                { x: 5.5, y: 0 },
                { x: 8.5, y: 0 },
                { x: 8.5, y: 3 },
                { x: 5.5, y: 3 },
              ].map(rotate),
              attach: true,
            };
      const result = session.apply(operation);
      assert.equal(result.status, 'applied', JSON.stringify(result.issues));
      const after = session.getSnapshot().floors[0];
      assert.deepEqual(buildingPlanBoundaryClearanceIssues(after), []);
      assert.ok(after.walls.filter((w) => w.exposure === 'interior').length > 0);
      assert.ok(
        after.walls.every(
          (w) => w.properties.wall_thickness_m === (w.exposure === 'interior' ? 0.2 : 0.5)
        )
      );
      assert.deepEqual(session.validate(), []);
      assert.ok(
        Math.abs(polygonArea(after.rooms[1].vertices) - polygonArea(floor.rooms[1].vertices)) <
          1e-7,
        'The stationary neighbour keeps its clear area.'
      );
      const openings = (floor) =>
        floor.walls.flatMap((wall) =>
          wall.doors.map((opening) => ({
            id: opening.id,
            width: opening.width,
            start: at(segmentFrame(wall.segments[0].start, wall.segments[0].end), opening.offset),
          }))
        );
      const previousOpenings = openings(floor),
        nextOpenings = openings(after);
      assert.equal(nextOpenings.length, previousOpenings.length);
      for (const opening of previousOpenings) {
        const next = nextOpenings.find((value) => value.id === opening.id);
        assert.equal(next.width, opening.width);
        assert.ok(
          Math.hypot(next.start.x - opening.start.x, next.start.y - opening.start.y) < 1e-7
        );
      }
      session.undo();
      assert.deepEqual(session.getSnapshot(), before);
      session.redo();
      assert.deepEqual(session.getSnapshot().floors[0], after);
    });
  }

for (const type of ['resize_face', 'create_room'])
  for (const value of ['apply', 'preserve', 'cancel']) {
    test(`mixed-thickness ${type} retains one managed ${value} decision and atomic history`, () => {
      const f = createBuildingPlanExample();
      const session = createBuildingPlanSession({
        snapshot: f.snapshot,
        properties: f.meta.properties,
        editingPolicy: { inheritedChangePolicy: 'apply', copyCustomAnswersAutomatically: true },
      });
      assert.equal(
        session.apply({
          type: 'set_provider',
          floorId: f.floorId,
          nodeKey: 'floors',
          fieldName: 'floor_exterior_wall_thickness',
          property: 'wall_thickness_m',
          value: 0.5,
        }).status,
        'applied'
      );
      session.setEditingPolicy({ inheritedChangePolicy: 'ask' });
      const before = session.getSnapshot(),
        floor = before.floors[0];
      const face = floor.rooms[0].faces.find(
        (face) => floor.walls.find((wall) => wall.id === face.wallId).autoLabel === 'W2'
      );
      const operation =
        type === 'resize_face'
          ? { type, floorId: f.floorId, faceId: face.id, distance: 1 }
          : {
              type,
              floorId: f.floorId,
              rectangle: { x: 5.5, y: 0, width: 3, height: 3 },
              attach: true,
            };
      const pending = session.apply(operation);
      assert.equal(pending.status, 'pending', JSON.stringify(pending.issues));
      assert.equal(pending.uiOperations.length, 1);
      assert.deepEqual(session.getSnapshot(), before);
      const requestId = pending.uiOperations[0].params.requestId;
      const accepted = session.resolveUIRequest(requestId, { value });
      assert.equal(
        accepted.status,
        value === 'cancel' ? 'unchanged' : 'applied',
        JSON.stringify(accepted.issues)
      );
      assert.deepEqual(session.validate(), []);
      if (value === 'cancel') assert.deepEqual(session.getSnapshot(), before);
      else {
        assert.deepEqual(buildingPlanBoundaryClearanceIssues(session.getSnapshot().floors[0]), []);
        session.undo();
        assert.deepEqual(session.getSnapshot(), before);
      }
      assert.equal(session.resolveUIRequest(requestId, { value }).status, 'conflict');
    });
  }

test('rooms receive live floor values and preserve override/reset intent through serialization', () => {
  const f = fixture();
  assert.equal(f.floor().rooms[0].properties.room_structural_clear_height, 3);
  f.apply({
    type: 'set_property',
    floorId: f.floorId,
    nodeKey: 'rooms',
    roomId: f.roomId,
    property: 'room_elevation',
    value: 1,
  });
  f.provide('floor_elevation', 'room_elevation', 2);
  assert.equal(f.floor().rooms[0].properties.room_elevation, 1);
  f.apply({
    type: 'set_property',
    floorId: f.floorId,
    nodeKey: 'rooms',
    roomId: f.roomId,
    property: 'room_elevation',
    reset: true,
  });
  assert.equal(f.floor().rooms[0].properties.room_elevation, 2);
  assert.equal(f.floor().rooms[0].provenance.room_elevation.scope, 'floor');
  const record = writeBuildingPlanRecord({ meta: f.meta, plan: f.domain.getSnapshot() });
  const roundtrip = readBuildingPlanRecord({ meta: f.meta, record });
  assert.equal(roundtrip.floors[0].rooms[0].properties.room_elevation, 2);
  assert.equal(Object.hasOwn(roundtrip.floors[0].rooms[0].overrides, 'room_elevation'), false);
  assert.equal(f.floor().walls[0].properties.wall_height_m, null);
});

test('plaster uses canonical room/outside context independently from physical exposure', () => {
  const f = fixture();
  for (const wall of f.floor().walls) {
    assert.equal(wall.exposure, 'exterior');
    for (const side of wall.sides) {
      assert.equal(
        side.properties.wall_plaster.choice[0].value,
        side.roomId ? 'plastered' : 'not_plastered'
      );
      assert.equal(side.properties.wall_plaster_thickness, side.roomId ? 0.015 : null);
    }
  }
  const before = f.floor().rooms[0].vertices;
  f.provide('floor_interior_wall_plaster_thickness', 'wall_plaster_thickness', 0.03);
  assert.deepEqual(f.floor().rooms[0].vertices, before);
  f.provide('floor_interior_wall_plaster', 'wall_plaster', choice('not_plastered'));
  assert.ok(
    f
      .floor()
      .walls.every((wall) =>
        wall.sides.every((side) => side.properties.wall_plaster_thickness === null)
      )
  );
});

test('explicit face plaster answers copy safely on a deliberate Split', () => {
  const f = fixture(),
    face = f.floor().rooms[0].faces[0];
  f.apply({
    type: 'set_property',
    floorId: f.floorId,
    faceId: face.id,
    scope: 'wall_face',
    property: 'wall_plaster_thickness',
    value: 0.02,
  });
  f.apply({ type: 'split_face', floorId: f.floorId, faceId: face.id, offset: 2 });
  assert.equal(
    f
      .floor()
      .walls.flatMap((wall) => wall.sides)
      .filter((side) => side.overrides.wall_plaster_thickness === 0.02).length,
    2
  );
});

test('SI/Imperial presentation converts declared measurements and leaves schemas/answers unchanged', () => {
  const f = fixture(),
    floor = f.meta.repeatablesByNodeKey.floors.fieldsByOriginalDataName;
  const before = JSON.stringify({ schema: f.expanded.schema, plan: f.domain.getSnapshot() });
  const si = createBuildingPlanPresentation({ metadata: [f.meta], locale: 'fr-FR' });
  const imperial = createBuildingPlanPresentation({
    metadata: [f.meta],
    measurementSystem: 'imperial',
    locale: 'it',
  });
  assert.equal(
    si.field(floor.floor_interior_wall_thickness.field).label,
    'Épaisseur prédominante des murs intérieurs [mm]'
  );
  assert.equal(si.toDisplay(floor.floor_interior_wall_thickness.field, 0.3), 300);
  assert.equal(si.fromDisplay(floor.floor_interior_wall_thickness.field, 300), 0.3);
  assert.equal(imperial.toDisplay(floor.floor_height.field, 0.3048), 1);
  assert.equal(imperial.fromDisplay(floor.floor_interior_wall_thickness.field, 1), 0.0254);
  assert.equal(si.toDisplay(floor.floor_upper_number.field, 3), 3);
  const shown = si.field(floor.floor_name.field);
  assert.equal(shown.choices.find((c) => c.value === 'ground_floor').label, 'Rez-de-chaussée');
  assert.equal(
    si.fromDisplay(shown, choice('ground_floor', 'Rez-de-chaussée')).choice[0].label,
    'Ground floor'
  );
  for (const locale of ['en', 'es', 'fr', 'it', 'de']) {
    const p = createBuildingPlanPresentation({ metadata: [f.meta], locale });
    assert.equal(p.field(floor.floor_name.field).choices[0].value, 'land_survey');
  }
  assert.equal(JSON.stringify({ schema: f.expanded.schema, plan: f.domain.getSnapshot() }), before);
});

test('measurement profile and generated optional system controls are validated', () => {
  const f = fixture(),
    raw = JSON.stringify(f.schema);
  assert.throws(
    () =>
      createFormEngine({ schema: { form: { ...f.schema.form, measurement_system: 'metric' } } }),
    /measurement_system/
  );
  const changed = structuredClone(f.expanded.schema);
  const field = changed.form.elements[0].elements[0].elements[0].elements.find((f) =>
    f.data_name.startsWith('floor_interior_wall_plaster_')
  );
  field.required = true;
  assert.throws(() => expandBuildingPlanSchema(changed), /protected/);
  assert.equal(JSON.stringify(f.schema), raw);
  assert.ok(!raw.includes('mandatory_elements'));
});

test('normalizing untouched optional choices does not create parent edits that block child Cancel', () => {
  const f = fixture();
  const record = writeBuildingPlanRecord({ meta: f.meta, plan: f.domain.getSnapshot() });
  const nodes = f.meta.repeatablesByNodeKey;
  const floorRow = record.repeatable[nodes.floors.preferredKey][0];
  for (const surface of ['interior', 'exterior']) {
    floorRow.values[
      nodes.floors.fieldsByOriginalDataName[`floor_${surface}_wall_plaster`].dataName
    ] = null;
    floorRow.values[
      nodes.floors.fieldsByOriginalDataName[`floor_${surface}_wall_plaster_thickness`].dataName
    ] = null;
  }
  const editor = createBuildingPlanEditor({ meta: f.meta, record });
  const path = [{ key: nodes.floors.preferredKey, id: floorRow.id }];
  const parent = editor.openRow({ path, scopeId: 'floor' });
  const added = editor.openRow({
    path: [...path, { key: nodes.rooms.preferredKey, id: 'new-room' }],
    scopeId: 'child',
    parentScopeId: 'floor',
    row: { id: 'new-room', values: {}, repeatable: {} },
  });
  assert.equal(added.status, 'opened');
  const sections = f.expanded.schema.form.elements[0].elements[0].elements.filter(
    (field) => field.type === 'Section'
  );
  const engine = createFormEngine({
    schema: { form: { name: 'Floor row', elements: sections } },
    initialValues: parent.row.values,
  });
  engine.eval();
  const current = editor.resolveRow(path).row;
  const result = editor.completeRow(
    'floor',
    { ...current, values: engine.getState().values },
    { finishAll: true }
  );
  assert.ok(['unchanged', 'applied'].includes(result.status), JSON.stringify(result));
  assert.equal(editor.cancelRow('child').status, 'cancelled');
  assert.equal(
    readBuildingPlanRecord({ meta: f.meta, record: editor.getRecord() }).floors[0].rooms.length,
    1
  );
});

test('empty normalized choices do not become defaults unless explicit unknown intent is recorded', () => {
  const f = fixture(),
    empty = { choice: [], other: [] };
  f.apply({
    type: 'set_values',
    floorId: f.floorId,
    nodeKey: 'floors',
    values: { floor_interior_wall_plaster: empty, floor_exterior_wall_plaster: empty },
  });
  for (const side of f.floor().walls.flatMap((wall) => wall.sides))
    assert.equal(side.provenance.wall_plaster.scope, 'schema');
  f.provide('floor_interior_wall_plaster', 'wall_plaster', empty);
  for (const side of f
    .floor()
    .walls.flatMap((wall) => wall.sides)
    .filter((side) => side.roomId)) {
    assert.equal(side.provenance.wall_plaster.scope, 'floor');
    assert.deepEqual(side.properties.wall_plaster, empty);
  }
});
