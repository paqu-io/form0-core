import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanPresentation, expandBuildingPlanSchema } from '../src/index.js';
import {
  BUILDING_PLAN_MEASURES,
  BUILDING_PLAN_UNITLESS_FIELDS,
} from '../src/schema/building-plan-measures.js';

const schema = (measurementSystem) => ({
  form: {
    name: 'Building',
    ...(measurementSystem ? { measurement_system: measurementSystem } : {}),
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
});
const meta = expandBuildingPlanSchema(schema()).buildingPlanMeta[0];
const visibleNumbers = meta.repeatables.flatMap((node) =>
  node.fields.filter(
    (entry) =>
      entry.binding?.system && entry.field.type === 'NumericField' && entry.field.visible !== false
  )
);

test('every visible numeric system field declares its measure or is a count', () => {
  const undeclared = visibleNumbers
    .map((entry) => entry.originalDataName)
    .filter(
      (name) => !BUILDING_PLAN_MEASURES[name] && !BUILDING_PLAN_UNITLESS_FIELDS.includes(name)
    );
  assert.deepEqual([...new Set(undeclared)], []);
  assert.ok(visibleNumbers.length > 20);
});

test('names carry no unit and labels follow the measure and the measurement system', () => {
  for (const entry of visibleNumbers) assert.doesNotMatch(entry.originalDataName, /_(?:m|mm)$/);
  const field = (node, name) =>
    meta.repeatablesByNodeKey[node].fieldsByOriginalDataName[name].field;
  for (const [system, length, thickness] of [
    ['si', 'm', 'mm'],
    ['imperial', 'ft', 'in'],
  ]) {
    const presentation = createBuildingPlanPresentation({
      metadata: [meta],
      measurementSystem: system,
    });
    const label = (node, name) => presentation.field(field(node, name)).label;
    assert.equal(label('walls', 'wall_height'), `Height [${length}]`);
    assert.equal(label('walls', 'wall_thickness'), `Thickness [${thickness}]`);
    assert.equal(label('beams', 'beam_depth'), `Depth [${length}]`);
    assert.equal(label('columns', 'column_width'), `Width [${length}]`);
  }
});
