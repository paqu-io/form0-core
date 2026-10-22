import assert from 'node:assert/strict';
import {
  createFormEngine,
  expandBuildingPlanSchema,
  flattenFields,
  SAFE_SECURITY_CONFIG,
  validateSchema,
  WarningSystem,
} from '../src/index.js';
import { ContextResolver } from '../src/engine/context-resolver.js';
import {
  calculatedField,
  formSchema,
  numericField,
  repeatableSection,
  textField,
} from './helpers/calculation-fixtures.js';

const properties = ['visible_conditions', 'required_conditions', 'read_only_conditions'];
const mapFor = {
  visible_conditions: 'visible',
  required_conditions: 'required',
  read_only_conditions: 'read_only',
};
const condition = (field_id, operator = 'greater_than', value = 0) => ({
  field_id,
  operator,
  value,
});
const number = (name, value = 50) =>
  numericField(name, { key: `key_${name}`, default_value: value });
const section = (name, elements) => ({
  type: 'Section',
  key: `key_${name}`,
  data_name: name,
  label: name,
  display: 'inline',
  description: null,
  description_mode: null,
  visible: true,
  visible_conditions: null,
  elements,
});
const fixture = () =>
  formSchema([
    number('root_value'),
    textField('root_target'),
    repeatableSection('parents', [
      number('parent_value'),
      textField('parent_target'),
      section('parent_section', [textField('section_target')]),
      repeatableSection('children', [
        number('child_value'),
        textField('child_target'),
        repeatableSection('grandchildren', [number('grandchild_value'), textField('deep_target')]),
      ]),
      repeatableSection('sibling_children', [number('sibling_value')]),
    ]),
    repeatableSection('unrelated', [number('unrelated_value'), textField('unrelated_target')]),
  ]);
const find = (schema, name) =>
  flattenFields(schema.form.elements).find((f) => f.data_name === name);
const configure = (schema, name, property, rule) => {
  const owner = find(schema, name);
  owner[property] = rule;
  owner[mapFor[property]] = false;
  return owner;
};
const makeEngine = (schema, options = {}) =>
  createFormEngine({ schema, diagnostics: { console: false }, ...options });

let checks = 0;
// Indexing precedes validation; malformed keys must still reach the schema error handler.
const malformed = formSchema([numericField('invalid_key', { key: 42 })]);
for (const run of [() => validateSchema(malformed.form), () => makeEngine(malformed)]) {
  assert.throws(run, (error) => error instanceof Error && !(error instanceof TypeError));
}
checks++;
for (const property of properties) {
  const unknownSchema = fixture();
  configure(unknownSchema, 'parent_target', property, condition('missing'));
  assert.throws(
    () => validateSchema(unknownSchema.form),
    /Condition references unknown field "missing" in field "parent_target"/
  );
  checks++;
  for (const [owner, reference] of [
    ['root_target', 'root_value'],
    ['parent_target', 'parent_value'],
    ['parent_target', 'root_value'],
    ['child_target', 'child_value'],
    ['child_target', 'parent_value'],
    ['deep_target', 'root_value'],
    ['deep_target', 'parent_value'],
    ['deep_target', 'child_value'],
    ['deep_target', 'grandchild_value'],
  ]) {
    for (const alias of [reference, `key_${reference}`]) {
      const schema = fixture();
      configure(schema, owner, property, condition(alias));
      assert.doesNotThrow(() => validateSchema(schema.form));
      const engine = makeEngine(schema);
      engine.eval();
      assert.equal(engine.getState()[mapFor[property]][owner], true);
      checks++;
    }
  }
  for (const [owner, reference] of [
    ['root_target', 'parent_value'],
    ['parent_target', 'child_value'],
    ['child_target', 'grandchild_value'],
    ['child_target', 'sibling_value'],
    ['child_target', 'unrelated_value'],
    ['unrelated_target', 'parent_value'],
  ]) {
    const schema = fixture();
    configure(schema, owner, property, condition(`key_${reference}`));
    for (const run of [() => validateSchema(schema.form), () => makeEngine(schema)]) {
      assert.throws(run, (error) => {
        assert.match(error.message, /outside its record scope/);
        for (const detail of [owner, reference, property, 'owner:', 'reference:']) {
          assert.ok(error.message.includes(detail), error.message);
        }
        return true;
      });
      checks++;
    }
  }
}

// Every branch is checked before runtime boolean short-circuiting can conceal it.
for (const property of properties) {
  for (const rule of [
    { or: [condition('root_value'), condition('unrelated_value')] },
    { and: [condition('root_value', 'less_than', 0), condition('unrelated_value')] },
    [condition('root_value'), { or: [condition('unrelated_value', 'not_equal_to', 50)] }],
  ]) {
    const schema = fixture();
    configure(schema, 'parent_target', property, rule);
    assert.throws(() => makeEngine(schema), /outside its record scope/);
    checks++;
  }
}

for (const [owner, allowed, blocked] of [
  ['parents', 'root_value', 'parent_value'],
  ['children', 'parent_value', 'child_value'],
  ['grandchildren', 'child_value', 'grandchild_value'],
  ['parent_section', 'parent_value', 'child_value'],
]) {
  const schema = fixture();
  configure(schema, owner, 'visible_conditions', condition(allowed));
  const engine = makeEngine(schema);
  engine.eval();
  assert.equal(engine.getState().visible[owner], true);
  configure(schema, owner, 'visible_conditions', condition(blocked));
  assert.throws(() => makeEngine(schema), /outside its record scope/);
  checks++;
}

const labelSchema = fixture();
const label = {
  type: 'LabelField',
  key: 'label',
  data_name: 'label',
  label: 'Display only',
  display: 'default',
  description: null,
  description_mode: null,
  required: false,
  visible: false,
  visible_conditions: condition('parent_value'),
  read_only: true,
  default_value: null,
  supporting_image: false,
  supporting_image_path: null,
  supporting_image_display: null,
};
find(labelSchema, 'parents').elements.push(label);
assert.doesNotThrow(() => makeEngine(labelSchema));
label.visible_conditions = condition('unrelated_value');
assert.throws(() => makeEngine(labelSchema), /outside its record scope/);
label.visible_conditions = condition('missing');
assert.throws(() => makeEngine(labelSchema), /Condition references unknown field "missing"/);
checks++;

const paymentSchema = formSchema([
  repeatableSection('inspections', [number('inspection_score')]),
  repeatableSection('payments', [textField('approval_note')]),
]);
configure(
  paymentSchema,
  'approval_note',
  'required_conditions',
  condition('inspection_score', 'less_than', 80)
);
assert.throws(
  () => makeEngine(paymentSchema, { initialValues: { inspection_score: 95, approval_note: '' } }),
  /approval_note.*required_conditions.*inspection_score.*payments.*inspections/
);
checks++;

for (const property of properties) {
  const schema = fixture();
  configure(schema, 'parent_target', property, condition('root_value'));
  const warnings = [];
  const warningSystem = new WarningSystem({ enableConsoleWarnings: false });
  warningSystem.addWarningHandler((warning) => warnings.push(warning));
  const engine = makeEngine(schema, { warningSystem });
  engine.eval();
  const owner = find(engine.getPreparedSchema(), 'parent_target');
  owner[property] = {
    or: [condition('root_value'), condition('unrelated_value', 'not_equal_to', 0)],
  };
  assert.throws(() => engine.eval(), /outside its record scope/);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].type, 'FIELD_ACCESS_WARNING');
  assert.equal(warnings[0].executionContext.type, 'condition');
  assert.equal(warnings[0].executionContext.fieldName, 'parent_target');
  assert.equal(warnings[0].executionContext.conditionProperty, property);
  assert.deepEqual(warnings[0].executionContext.parentPath, ['parents']);
  assert.deepEqual(warnings[0].fieldContext.parentPath, ['unrelated']);
  assert.deepEqual(engine.getState().errors, {});
  assert.deepEqual(engine.getDiagnostics(), []);
  owner[property] = condition('missing');
  assert.throws(() => engine.eval(), /Condition references unknown field "missing"/);
  checks++;
}

for (const security of [undefined, SAFE_SECURITY_CONFIG]) {
  for (const scores of [
    [95, 90],
    [95, 60],
  ]) {
    const schema = formSchema([
      calculatedField('inspection_scores', `SETRESULT(${JSON.stringify(scores)})`, {
        display: { style: 'text' },
      }),
      repeatableSection('payments', [
        calculatedField(
          'needs_approval_note',
          'SETRESULT($inspection_scores.some((score) => score < 80))',
          { display: { style: 'text' }, visible: false }
        ),
        textField('approval_note', {
          required: true,
          visible: false,
          visible_conditions: condition('needs_approval_note', 'equal_to', true),
        }),
      ]),
    ]);
    const engine = makeEngine(schema, { security });
    engine.eval();
    assert.equal(engine.getState().visible.approval_note, scores[1] < 80);
    assert.deepEqual(engine.getDiagnostics(), []);
    checks++;
  }
}

const building = {
  type: 'BuildingPlanSection',
  key: 'bp',
  data_name: 'building',
  label: 'Building',
  description: null,
  description_mode: null,
  visible: false,
  visible_conditions: condition('root_value'),
  read_only: false,
  read_only_conditions: null,
  node_overrides: null,
};
const buildingSchema = formSchema([number('root_value'), building]);
assert.doesNotThrow(() => makeEngine(buildingSchema));
const expanded = expandBuildingPlanSchema(buildingSchema).schema;
const generatedRowField = flattenFields(expanded.form.elements).find(
  (field) => field.type === 'NumericField' && field.data_name !== 'root_value'
);
assert.ok(generatedRowField);
expanded.form.elements[1].visible_conditions = condition(generatedRowField.key);
assert.throws(() => validateSchema(expanded.form), /outside its record scope/);
expanded.form.elements[1].visible_conditions = condition('root_value');
expanded.form.elements[1].read_only_conditions = condition('root_value');
assert.doesNotThrow(() => makeEngine(expanded));
expanded.form.elements[1].read_only_conditions = condition(generatedRowField.key);
assert.throws(
  () => makeEngine(expanded),
  /building.*read_only_conditions.*outside its record scope/
);
checks++;

const wide = formSchema([number('root_value')]);
for (let i = 0; i < 500; i++) {
  wide.form.elements.push(textField(`wide_${i}`, { required_conditions: condition('root_value') }));
}
let children = [textField('deep_leaf', { required_conditions: condition('root_value') })];
for (let depth = 0; depth < 12; depth++) children = [repeatableSection(`depth_${depth}`, children)];
wide.form.elements.push(...children);
const originalBuild = ContextResolver.prototype.buildFieldContext;
let rootBuilds = 0;
ContextResolver.prototype.buildFieldContext = function (...args) {
  if (args.length === 1) rootBuilds++;
  return originalBuild.apply(this, args);
};
try {
  const started = performance.now();
  const engine = makeEngine(wide);
  for (let i = 0; i < 5; i++) engine.eval();
  assert.equal(
    rootBuilds,
    1,
    'one ownership index per engine, reused by validation and repeated evaluations'
  );
  assert.equal(engine.getState().required.deep_leaf, true);
  console.log(
    `wide/deep fixture: ${flattenFields(wide.form.elements).length} elements, 12 levels, five evaluations in ${(performance.now() - started).toFixed(1)}ms`
  );
} finally {
  ContextResolver.prototype.buildFieldContext = originalBuild;
}
checks++;

console.log(`condition scope checks passed (${checks} scenarios)`);
