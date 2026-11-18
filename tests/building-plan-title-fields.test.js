import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDatasetDescriptors,
  expandBuildingPlanSchema,
  resolveDatasetRowTitle,
  validateSchema,
} from '../src/index.js';

const choice = (value, label = value) => ({ choice: [{ value, label }], other: [] });

/** The expanded schema and its plan metadata. */
function expanded() {
  const result = expandBuildingPlanSchema({
    form: {
      name: 'Titles',
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
  });
  return { schema: result.schema, meta: result.buildingPlanMeta[0] };
}

function findRepeatable(elements, key) {
  for (const element of elements || []) {
    if (element.type === 'RepeatableSection' && element.key === key) return element;
    const found = findRepeatable(element.elements, key);
    if (found) return found;
  }
  return null;
}

test('every plan section titles its rows by its name field, the generic way', () => {
  const { schema, meta } = expanded();
  for (const [nodeKey, name] of [
    ['floors', 'floor_name'],
    ['rooms', 'room_name'],
    ['physical_walls', 'wall_label'],
    ['walls', 'wall_label'],
    ['doors', 'door_label'],
    ['windows', 'window_label'],
    ['columns', 'column_identifier'],
    ['beams', 'beam_identifier'],
  ]) {
    const node = meta.repeatablesByNodeKey[nodeKey];
    const section = findRepeatable(schema.form.elements, node.key);
    assert.ok(section, `${nodeKey} is expanded`);
    assert.equal(section.title_field?.type, 'TitleField', `${nodeKey} has a title field`);
    assert.deepEqual(section.title_field.elements, [node.fieldsByOriginalDataName[name].key]);
  }
  // The expanded schema validates: each title field is in scope and title-eligible.
  assert.doesNotThrow(() => validateSchema(schema.form));
});

test('a floor and a room are titled by their names in dataset titles', () => {
  const { schema, meta } = expanded();
  const descriptors = buildDatasetDescriptors(schema);
  const descriptorOf = (nodeKey) =>
    descriptors.find(
      (descriptor) => descriptor.repeatable_field_id === meta.repeatablesByNodeKey[nodeKey].key
    );
  const field = (nodeKey, name) =>
    meta.repeatablesByNodeKey[nodeKey].fieldsByOriginalDataName[name].dataName;

  assert.equal(
    resolveDatasetRowTitle(descriptorOf('floors'), {
      [field('floors', 'floor_name')]: choice('ground_floor', 'Ground floor'),
    }),
    'Ground floor'
  );
  assert.equal(
    resolveDatasetRowTitle(descriptorOf('rooms'), { [field('rooms', 'room_name')]: 'Kitchen' }),
    'Kitchen'
  );
  // A wall face is titled by its label, projected from its physical wall.
  assert.equal(
    resolveDatasetRowTitle(descriptorOf('walls'), { [field('walls', 'wall_label')]: 'W4' }),
    'W4'
  );
  // A row without a name has no title, so hosts keep their "Floors 1" fallback.
  assert.equal(resolveDatasetRowTitle(descriptorOf('floors'), {}), null);
});

test('plan rows are titled for display only: stored records keep no row titles', async () => {
  const { createBuildingPlanExample } = await import('../examples/building-plan/create-example.js');
  const { normalizeStructuredRecord } = await import('../src/index.js');
  const example = createBuildingPlanExample();
  const titles = [];
  const visit = (value, root = false) => {
    if (Array.isArray(value)) return value.forEach((item) => visit(item));
    if (!value || typeof value !== 'object') return;
    if (!root && '@title' in value && value['@title'] !== null) titles.push(value['@title']);
    Object.entries(value).forEach(([key, item]) => key !== '@title' && visit(item));
  };
  visit(example.stored, true);
  visit(normalizeStructuredRecord(example.schema, example.stored, { mode: 'derived' }), true);
  assert.deepEqual(titles, []);
});
