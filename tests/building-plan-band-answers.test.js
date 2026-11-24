import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession, expandBuildingPlanSchema } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

// Bands unit 1 (decided 2026-11-24, F2 to F5, B; form0-react `analyses/building-plan-ui.md`,
// "Floor defaults for bands"): the floor asks whether every wall has a ring beam, a lintel band
// and a sill band, with their undersides and depths, in a "Ring beam and bands" section inside
// its System fields; each wall inherits the answer (Yes or No), overrides and resets it, as
// plaster. Wall beams get a band-kind field, kept by the engine (unit 2).

function repeatable(elements, label) {
  for (const element of elements || []) {
    if (element.type === 'RepeatableSection' && element.label === label) return element;
    const nested = repeatable(element.elements, label);
    if (nested) return nested;
  }
  return null;
}
const systemSection = (node) =>
  node.elements.find((element) => element.type === 'Section' && element.label === 'System fields');
const bandsIn = (node) =>
  systemSection(node).elements.find((element) => element.label === 'Ring beam and bands');

function example() {
  const f = createBuildingPlanExample();
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    createId: () => `c-${++serial}`,
    derivedCommands: true,
  });
  const floor = () => session.getSnapshot().floors[0];
  const apply = (operation) => session.apply({ floorId: f.floorId, ...operation });
  const wall = (label) => floor().walls.find((entry) => entry.autoLabel === label);
  const answer = (value, label) => ({ choice: [{ value, label }], other: [] });
  const setWall = (label, property, value, extra = {}) => {
    const target = wall(label);
    const face = floor().rooms[0].faces.find((entry) => entry.wallId === target.id);
    return apply({
      type: 'set_property',
      property,
      value,
      nodeKey: 'walls',
      scope: 'physical_wall',
      wallId: target.id,
      faceId: face.id,
      activeRoomId: floor().rooms[0].id,
      ...extra,
    });
  };
  return { f, floor, apply, wall, answer, setWall };
}
const applied = (result) => assert.equal(result.status, 'applied', JSON.stringify(result.issues));
const lintel = (wall) => wall.properties.wall_lintel_band?.choice?.[0] ?? null;

test('the floor asks in a section of its own; walls and room walls answer Yes or No', () => {
  const { schema, buildingPlanMeta } = expandBuildingPlanSchema(createBuildingPlanExample().schema);
  // Long scoped names are cut short; the meta keeps each field's original name.
  const original = new Map(
    buildingPlanMeta[0].repeatables.flatMap((node) =>
      node.fields.map((entry) => [entry.dataName, entry.originalDataName])
    )
  );
  const base = (name) => original.get(name) ?? name;
  const floors = repeatable(schema.form.elements, 'Floors');
  const floorBands = bandsIn(floors);
  assert.deepEqual(
    floorBands.elements.map((field) => base(field.data_name)),
    [
      'floor_ring_beam',
      'floor_ring_beam_depth',
      'floor_lintel_band',
      'floor_lintel_band_distance_from_floor',
      'floor_lintel_band_depth',
      'floor_sill_band',
      'floor_sill_band_distance_from_floor',
      'floor_sill_band_depth',
    ]
  );
  const [ring, ringDepth] = floorBands.elements;
  assert.deepEqual(
    ring.choices.map((choice) => choice.label),
    ['Every wall has a ring beam', 'No wall has a ring beam']
  );
  assert.equal(ringDepth.visible, false);
  assert.deepEqual(ringDepth.visible_conditions, {
    field_id: ring.key,
    operator: 'equal_to',
    value: 'yes',
  });
  for (const label of ['Physical walls', 'Walls']) {
    const fields = bandsIn(repeatable(schema.form.elements, label)).elements;
    assert.deepEqual(
      fields.map((field) => [base(field.data_name), field.label]),
      [
        ['wall_ring_beam', 'Ring beam'],
        ['wall_lintel_band', 'Lintel band'],
        ['wall_sill_band', 'Sill band'],
      ]
    );
    assert.deepEqual(
      fields[0].choices.map((choice) => choice.label),
      ['Yes', 'No']
    );
  }
  const beams = repeatable(repeatable(schema.form.elements, 'Physical walls').elements, 'Beams');
  const kind = systemSection(beams).elements.find(
    (field) => base(field.data_name) === 'wall_beam_band'
  );
  assert.deepEqual([kind.read_only, kind.visible, kind.required], [true, false, false]);
});

test("every wall inherits the floor's answer, in its own words; a wall overrides and resets it", () => {
  const t = example();
  const room = t.floor().rooms[0];
  applied(
    t.apply({
      type: 'create_wall',
      roomId: room.id,
      vertices: [
        { x: 1, y: 1.5 },
        { x: 4, y: 1.5 },
      ],
    })
  );
  applied(
    t.apply({
      type: 'set_provider',
      nodeKey: 'floors',
      fieldName: 'floor_lintel_band',
      property: 'wall_lintel_band',
      value: t.answer('yes', 'Every wall has a lintel band'),
    })
  );
  for (const wall of t.floor().walls)
    assert.deepEqual(lintel(wall), { value: 'yes', label: 'Yes' });
  applied(t.setWall('W1', 'wall_lintel_band', t.answer('no', 'No')));
  assert.deepEqual(lintel(t.wall('W1')), { value: 'no', label: 'No' });
  assert.deepEqual(lintel(t.wall('W2')), { value: 'yes', label: 'Yes' });
  applied(t.setWall('W1', 'wall_lintel_band', null, { reset: true }));
  assert.deepEqual(lintel(t.wall('W1')), { value: 'yes', label: 'Yes' });
});

test("a split's pieces keep the wall's answer", () => {
  const t = example();
  applied(t.setWall('W1', 'wall_lintel_band', t.answer('yes', 'Yes')));
  const north = t.floor().rooms[0].faces.find((face) => face.wallId === t.wall('W1').id).id;
  applied(t.apply({ type: 'split_face', faceId: north, offset: 2 }));
  for (const label of ['W1', 'W1.1'])
    assert.deepEqual(lintel(t.wall(label)), { value: 'yes', label: 'Yes' });
});

test('an inherited plaster status reads as the wall words it', () => {
  const t = example();
  applied(
    t.apply({
      type: 'set_provider',
      nodeKey: 'floors',
      fieldName: 'floor_interior_wall_plaster',
      property: 'wall_plaster',
      value: t.answer('plastered', 'All the interior walls are plastered'),
    })
  );
  const side = t.wall('W1').sides.find((entry) => entry.roomId);
  assert.deepEqual(side.properties.wall_plaster.choice, [
    { value: 'plastered', label: 'Plastered' },
  ]);
});

test('the band words are translated, with the measure in the label', async () => {
  const { createBuildingPlanPresentation } = await import('../src/index.js');
  const [meta] = expandBuildingPlanSchema(createBuildingPlanExample().schema).buildingPlanMeta;
  const field = (node, name) =>
    meta.repeatablesByNodeKey[node].fieldsByOriginalDataName[name].field;
  const fr = createBuildingPlanPresentation({ metadata: [meta], locale: 'fr' });
  assert.equal(
    fr.field(field('floors', 'floor_lintel_band_depth')).label,
    'Hauteur du bandeau de linteau [mm]'
  );
  assert.equal(
    fr.field(field('floors', 'floor_sill_band_distance_from_floor')).label,
    "Sous-face du bandeau d'allège [m]"
  );
  const wall = fr.field(field('physical_walls', 'wall_ring_beam'));
  assert.deepEqual(
    [wall.label, ...wall.choices.map((choice) => choice.label)],
    ['Chaînage', 'Oui', 'Non']
  );
});
