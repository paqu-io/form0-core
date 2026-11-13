// Mobile round 2026-11-13, issue 2: record preparation seeded every container (Section,
// RepeatableSection, BuildingPlanSection) with null, at the root and in every row. The nulls
// reached drafts and BuildingPlan rows, and a floor screen's value sync rejected them.
import assert from 'node:assert/strict';
import {
  createBuildingPlanSession,
  createRecordEvaluator,
  expandBuildingPlanSchema,
  writeBuildingPlanRecord,
} from '../src/index.js';
import { formSchema, repeatableSection, textField } from './helpers/calculation-fixtures.js';

const section = (dataName, elements, display = 'inline') => ({
  type: 'Section',
  key: dataName,
  data_name: dataName,
  label: dataName,
  display,
  description: null,
  description_mode: null,
  visible: true,
  visible_conditions: null,
  elements,
});

const schema = formSchema([
  section(
    'details',
    [textField('name'), textField('city', { default_value: 'Rome' })],
    'drilldown'
  ),
  repeatableSection('items', [
    section('item_details', [textField('note')]),
    repeatableSection('parts', [textField('part')]),
  ]),
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
]);

const expanded = expandBuildingPlanSchema(structuredClone(schema)).schema.form;
const containers = new Set();
const collect = (elements) => {
  for (const element of elements || []) {
    if (['Section', 'RepeatableSection', 'BuildingPlanSection'].includes(element.type))
      containers.add(element.data_name);
    collect(element.elements);
  }
};
collect(expanded.elements);
assert.ok(containers.size > 6, 'The expanded schema has plain and BuildingPlan containers');

const meta = expandBuildingPlanSchema(structuredClone(schema)).buildingPlanMeta[0];
const plan = createBuildingPlanSession();
const floorId = plan.apply({
  type: 'create_floor',
  values: { floor_elevation: 0, floor_height: 3 },
  defaults: { wall_height_m: 3 },
}).created.id;
plan.apply({ type: 'create_room', floorId, rectangle: { x: 0, y: 0, width: 4, height: 3 } });
const record = {
  values: { name: 'Casa' },
  repeatable: {
    ...writeBuildingPlanRecord({ meta, plan: plan.getSnapshot() }).repeatable,
    items: [{ id: 'item-1', values: {}, repeatable: { parts: [{ id: 'part-1', values: {} }] } }],
  },
};

/** Every values object in the record tree, with its path. */
function* scopes(node, path = 'root') {
  yield [path, node.values];
  for (const [key, rows] of Object.entries(node.repeatable || {}))
    for (const [index, row] of rows.entries()) yield* scopes(row, `${path}.${key}[${index}]`);
}

const evaluator = createRecordEvaluator({ schema });
const runs = {
  'submit preparation': (input) => evaluator.prepareSubmission(input),
  'draft preparation': (input) => evaluator.prepareSubmission(input, { intent: 'draft' }),
  evaluation: (input) => evaluator.evaluate(input),
};
for (const [label, run] of Object.entries(runs)) {
  const { snapshot } = await run(structuredClone(record));
  let rows = 0;
  for (const [path, values] of scopes(snapshot)) {
    rows++;
    const seeded = Object.keys(values).filter((name) => containers.has(name));
    assert.deepEqual(seeded, [], `${label}: no container keys in ${path}`);
  }
  assert.ok(rows >= 5, `${label}: the root, two plain rows, a floor and a room`);
  // Value fields keep their defaults, empty ones included.
  assert.equal(snapshot.values.name, 'Casa');
  assert.equal(snapshot.values.city, 'Rome');
  assert.equal(snapshot.repeatable.items[0].values.note, null);
  assert.ok(Object.hasOwn(snapshot.repeatable.items[0].values, 'note'));
  assert.equal(snapshot.repeatable.items[0].repeatable.parts[0].values.part, null);
  const floor = snapshot.repeatable[meta.repeatablesByNodeKey.floors.preferredKey][0];
  const plaster =
    meta.repeatablesByNodeKey.floors.fieldsByOriginalDataName.floor_interior_wall_plaster.dataName;
  assert.ok(Object.hasOwn(floor.values, plaster), `${label}: the floor's empty answer is kept`);
  assert.equal(floor.values[plaster], null);
}

console.log('Record preparation seeds every value field and no container.');
