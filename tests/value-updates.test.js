import assert from 'node:assert/strict';
import {
  createFormEngine,
  normalizeFieldValue,
  FIELD_SPECS,
  createStructuredRecord,
} from '../src/index.js';
import { auditField } from './fixtures/consumer-compatibility.js';

const choices = [
  { value: 'it', label: 'Italy' },
  { value: 'fr', label: 'France' },
  { value: '0', label: 'Zero' },
  { value: 'false', label: 'False' },
];
const field = (type, name, extra = {}) => auditField(FIELD_SPECS, type, name, extra);
const single = field('SingleChoiceField', 'country', { choices });
const multi = field('MultiChoiceField', 'countries', { choices });
const boolean = field('BooleanField', 'answer', { choices: choices.slice(0, 2) });
const schema = {
  form: {
    name: 'Value updates',
    elements: [
      field('NumericField', 'width', { read_only: true }),
      field('NumericField', 'height'),
      field('CalculatedField', 'area', { calculate: '$width * $height' }),
      single,
      multi,
      boolean,
      field('RepeatableSection', 'rows', { elements: [field('TextField', 'row_note')] }),
      field('LabelField', 'label'),
    ],
  },
};
const make = (options = {}) =>
  createFormEngine({ schema, diagnostics: { console: false }, ...options });

for (const [definition, shorthand, key] of [
  [single, 'it', 'choice'],
  [multi, ['it', 'fr'], 'choices'],
  [boolean, 'it', 'choice'],
]) {
  const result = normalizeFieldValue(definition, shorthand);
  assert.equal(result[key][0].label, 'Italy');
  assert.deepEqual(result.other, []);
  for (const empty of [null, undefined])
    assert.deepEqual(normalizeFieldValue(definition, empty), { [key]: [], other: [] });
  const explicit = {
    [key]: [{ value: 'it', label: 'Italia', meta: { source: 'import' } }],
    other: [],
    extra: { keep: true },
  };
  const copied = normalizeFieldValue(definition, explicit);
  assert.deepEqual(copied, explicit);
  copied[key][0].meta.source = 'changed';
  copied.extra.keep = false;
  assert.equal(explicit[key][0].meta.source, 'import');
  assert.equal(explicit.extra.keep, true);
  const unknown = normalizeFieldValue(definition, key === 'choices' ? ['xx', 'xx'] : 'xx');
  assert.equal(unknown[key][0].value, 'xx');
  if (key === 'choices') assert.equal(unknown[key].length, 2);
  for (const invalid of [
    0,
    false,
    {},
    { [key]: 'it' },
    { [key]: [{ label: 'Italy' }] },
    { [key]: [{ value: 0 }] },
    { [key]: [], other: 'Teal' },
  ])
    assert.throws(() => normalizeFieldValue(definition, invalid), TypeError);
}
assert.throws(() => normalizeFieldValue(single, ['it']), TypeError);
assert.throws(() => normalizeFieldValue(multi, 'it'), TypeError);
assert.throws(() => normalizeFieldValue(single, { choices: [], other: [] }), TypeError);
assert.throws(() => normalizeFieldValue(multi, { choice: [], other: [] }), TypeError);
assert.deepEqual(normalizeFieldValue(single, { choice: [] }), { choice: [], other: [] });
assert.deepEqual(
  normalizeFieldValue(single, { choice: [], other: [{ label: '', meta: 'keep' }] }),
  { choice: [], other: [{ label: '', meta: 'keep' }] }
);
assert.equal(normalizeFieldValue(single, '').choice[0].value, '');
assert.equal(normalizeFieldValue(single, '0').choice[0].value, '0');
assert.equal(normalizeFieldValue(single, 'false').choice[0].value, 'false');

let evaluations = 0;
const engine = make({
  initialValues: { width: 3, height: 10 },
  onDiagnostics: () => evaluations++,
});
engine.eval();
assert.equal(engine.getState().values.area, 30);
const state = engine.setValues({ width: 4, height: 5, country: 'it', countries: ['it', 'fr'] });
assert.equal(state.values.area, 20);
assert.equal(evaluations, 2);
assert.equal(engine.setValue('width', 0).values.area, 0);
const count = evaluations;
engine.setValues({});
assert.equal(evaluations, count);
const before = structuredClone(engine.getState());
for (const updates of [
  undefined,
  null,
  [],
  'x',
  { width: 7, typo: 4 },
  { width: 7, country: false },
  { area: 99 },
  { label: 'x' },
  { rows: [] },
  { row_note: 'cross-scope' },
]) {
  assert.throws(() => engine.setValues(updates), TypeError);
  assert.deepEqual(engine.getState(), before);
  assert.equal(evaluations, count);
}
for (const name of [null, 3, '', undefined])
  assert.throws(() => engine.setValue(name, 1), TypeError);
engine.setValue('country', 'xx');
assert.equal(engine.getState().values.country.choice[0].value, 'xx');
assert.match(engine.getState().errors.country, /invalid value/);
engine.setMode('readonly');
assert.throws(() => engine.setValue('width', 8), TypeError);
engine.setMode('edit');
engine.setValue('width', 8);
assert.equal(engine.getState().values.area, 40);

const path = [{ repeatableKey: 'rows', instanceId: 0, index: 0, identity: 'id' }];
const row = make({ eventScope: { instancePath: path }, initialValues: { width: 3, height: 10 } });
assert.equal(row.setValue('row_note', 'local').values.row_note, 'local');
assert.throws(() => row.setValue('width', 8), TypeError);

const initialValues = {
  country: 'it',
  countries: ['fr'],
  answer: 'fr',
  area: 999,
  import_meta: { keep: true },
};
const loaded = make({ initialValues, mode: 'readonly' });
loaded.eval();
assert.equal(loaded.getState().values.country.choice[0].label, 'Italy');
assert.equal(loaded.getState().values.countries.choices[0].label, 'France');
assert.equal(loaded.getState().values.area, 999);
assert.deepEqual(loaded.getState().values.import_meta, { keep: true });
assert.equal(initialValues.country, 'it');
for (const invalid of [['it'], { choice: 'bad', other: [] }, false]) {
  const draft = make({ initialValues: { country: invalid } });
  draft.eval();
  assert.deepEqual(draft.getState().values.country, invalid);
  assert.ok(draft.getState().errors.country);
}
const output = createStructuredRecord(loaded.getState(), schema.form.elements).form_values;
assert.deepEqual(output.country, {
  choice_value: [{ value: 'it', label: 'Italy' }],
  other_value: [],
});
assert.deepEqual(output.countries, {
  choices_value: [{ value: 'fr', label: 'France' }],
  other_value: [],
});

const calculatedSchema = structuredClone(schema);
calculatedSchema.form.elements[3].default_value = 'it';
calculatedSchema.form.elements[4].default_value = ['it', 'fr'];
calculatedSchema.form.elements.push(
  field('CalculatedField', 'double_area', { calculate: '$area * 2' }),
  field('CalculatedField', 'selected_label', { calculate: 'CHOICELABEL($country)' }),
  field('CalculatedField', 'selected_value', { calculate: 'CHOICEVALUE($country)' }),
  field('CalculatedField', 'selected_values', { calculate: 'CHOICEVALUES($countries)' }),
  field('CalculatedField', 'observed_inputs', { calculate: 'observe($width, $height)' })
);
const observations = [];
const calculated = make({
  schema: calculatedSchema,
  initialValues: { width: 3, height: 10 },
  helpers: { observe: (width, height) => observations.push([width, height]) },
});
calculated.eval();
assert.equal(calculated.getState().values.country.choice[0].value, 'it');
assert.deepEqual(
  calculated.getState().values.countries.choices.map((entry) => entry.value),
  ['it', 'fr']
);
observations.length = 0;
calculated.setValues({ width: 4, height: 5, country: 'fr', countries: ['fr', '0', 'it'] });
assert.equal(calculated.getState().values.double_area, 40);
assert.equal(calculated.getState().values.selected_label, 'France');
assert.equal(calculated.getState().values.selected_value, 'fr');
assert.equal(calculated.getState().values.countries.choices[1].value, '0');
// Calculation result coercion remains the existing evaluator's contract.
assert.deepEqual(calculated.getState().values.selected_values, ['fr', 0, 'it']);
assert.ok(observations.length);
assert.ok(observations.every(([width, height]) => width === 4 && height === 5));

const events = structuredClone(schema);
events.form.events = {
  code: "ON('change', 'width', function () { SETVALUE('height', 20); }); ON('edit-record', function () { SETVALUE('area', 999); });",
};
const eventEngine = make({ schema: events, initialValues: { width: 3, height: 10 } });
eventEngine.setValue('width', 4);
assert.equal(eventEngine.getState().values.height, 10, 'setters do not dispatch change');
assert.equal(eventEngine.getState().values.area, 40);
const operations = eventEngine.triggerDetailed('change', 'width');
assert.equal(operations.operations.length, 1);
assert.equal(eventEngine.getState().values.height, 10, 'dispatch does not apply operations');
eventEngine.setValues(
  Object.fromEntries(
    operations.operations.map((op) => [op.params.fieldDataName, op.params.valueToSet])
  )
);
assert.equal(eventEngine.getState().values.area, 80);
assert.equal(eventEngine.triggerDetailed('edit-record').operations.length, 0);
assert.ok(eventEngine.triggerDetailed('edit-record').issues.length);

const legacySchema = structuredClone(schema);
legacySchema.form.events = {
  code: "ON('change', 'width', function () { SETVALUE('height', 20); SETVALUE('', 1); });",
};
const legacy = make({ schema: legacySchema, initialValues: { width: 3, height: 10 } });
assert.deepEqual(legacy.trigger('change', 'width'), [], 'invalid legacy targets reject the batch');
assert.equal(legacy.getState().values.height, 10);

const binary = new Blob(['media']);
assert.equal(
  normalizeFieldValue({ type: 'PhotoField', data_name: 'photo' }, [{ data: binary }])[0].data,
  binary
);
console.log('Value normalization and supported setter regressions passed.');
