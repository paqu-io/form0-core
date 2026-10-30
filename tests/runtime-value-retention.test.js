import assert from 'node:assert/strict';
import {
  createFormEngine,
  createRecordEvaluator,
  validateFieldValue,
  validateRecordFieldValue,
  validateSubmission,
  validateSchema,
  createStructuredRecord,
  flattenFields,
  SAFE_SECURITY_CONFIG,
} from '../src/index.js';
import {
  formSchema,
  textField,
  numericField,
  calculatedField,
  repeatableSection,
  commonInputAttributes,
} from './helpers/calculation-fixtures.js';

const temporal = (type) => {
  const { supporting_image, supporting_image_path, supporting_image_display, ...attributes } =
    commonInputAttributes;
  return { ...attributes, type, key: 'value', data_name: 'value', label: 'Value' };
};
const scalarCases = [
  [textField('value'), ['text', ' ', ''], [5, {}, [], false]],
  [
    numericField('value', { format: 'float' }),
    [0, -1, 1.5, ''],
    ['5', ' ', {}, false, NaN, Infinity, -Infinity],
  ],
  [
    temporal('DateField'),
    ['2024-02-29', '0001-01-01', '9999-12-31', ''],
    [
      '2026-02-29',
      '2026-02-30',
      '2026-13-45',
      '0000-01-01',
      'not-a-date',
      '2026-01-01T00:00:00Z',
      5,
      {},
    ],
  ],
  [
    temporal('TimeField'),
    ['00:00', '23:59', '23:59:59', ''],
    ['24:00', '00:60', '00:00:60', '9:00', '09:00Z', 5, {}],
  ],
];
for (const [field, good, bad] of scalarCases) {
  for (const value of [...good, null, undefined]) {
    assert.equal(validateFieldValue(field, value), null);
    assert.equal(validateRecordFieldValue(field, value), null);
  }
  for (const value of bad) {
    assert.ok(validateFieldValue(field, value), `${field.type}: ${String(value)}`);
    assert.equal(validateFieldValue(field, value), validateRecordFieldValue(field, value));
    const engine = createFormEngine({ schema: formSchema([field]), initialValues: { value } });
    engine.eval();
    assert.ok(engine.getState().errors.value);
    const prepared = await createRecordEvaluator({ schema: formSchema([field]) }).prepareSubmission(
      { values: { value } }
    );
    assert.equal(prepared.status, 'blocked');
    assert.deepEqual(prepared.snapshot.values.value, value);
  }
}
const patterned = textField('value', { pattern: '^a$', pattern_description: 'Only a' });
assert.equal(validateFieldValue(patterned, ''), null);
assert.ok(validateFieldValue(patterned, 'b'));
assert.ok(validateFieldValue(numericField('value'), 1.2));
assert.ok(validateFieldValue(numericField('value', { min: 1, max: 5 }), 6));
for (const setting of [null, 0, 'false'])
  assert.throws(
    () =>
      validateSchema(formSchema([textField('value', { visible_preserve_value: setting })]).form),
    /visible_preserve_value/
  );
assert.throws(
  () =>
    validateSchema(
      formSchema([calculatedField('value', '7', { visible_preserve_value: false })]).form
    ),
  /does not support/
);

for (const security of [undefined, SAFE_SECURITY_CONFIG]) {
  const options = { security, diagnostics: { console: false } };
  const schema = formSchema([
    textField('keep', { visible: false }),
    textField('explicit_keep', { visible: false, visible_preserve_value: true }),
    numericField('amount', {
      visible: false,
      visible_preserve_value: false,
      default_value: 8,
      read_only: true,
    }),
    calculatedField('total', 'SETRESULT(($amount ?? 0) + 1)'),
  ]);
  const engine = createFormEngine({
    schema,
    initialValues: { keep: 'keep', explicit_keep: 'also keep' },
    ...options,
  });
  engine.eval();
  assert.equal(engine.getState().values.amount, null);
  assert.equal(engine.getState().values.total, 1);
  engine.eval();
  assert.equal(engine.getState().values.amount, null);
  assert.equal(engine.getState().values.keep, 'keep');
  const view = createFormEngine({
    schema,
    initialValues: { amount: 8, total: 9 },
    mode: 'readonly',
    ...options,
  });
  view.eval();
  assert.equal(view.getState().values.amount, 8);
  const evaluated = await createRecordEvaluator({ schema, ...options }).prepareSubmission({
    values: { amount: 8 },
  });
  assert.equal(evaluated.status, 'ready');
  assert.equal(evaluated.snapshot.values.total, 1);
  assert.deepEqual(evaluated.clearedFields, [
    { instancePath: [], fieldName: 'amount', fieldKey: 'amount' },
  ]);
}
const cascadeSchema = formSchema([
  numericField('switcher'),
  textField('first', { visible: false, visible_preserve_value: false }),
  textField('second', {
    visible: false,
    visible_conditions: { field_id: 'first', operator: 'not_empty' },
    visible_preserve_value: false,
  }),
]);
// Use a known supported text condition operator.
cascadeSchema.form.elements[2].visible_conditions = {
  field_id: 'first',
  operator: 'equal_to',
  value: 'yes',
};
const cascade = createFormEngine({
  schema: cascadeSchema,
  initialValues: { first: 'yes', second: 'secret' },
});
cascade.eval();
assert.equal(cascade.getState().values.second, null);
const toggleSchema = formSchema([
  numericField('switcher'),
  textField('value', {
    visible: false,
    visible_conditions: { field_id: 'switcher', operator: 'equal_to', value: 1 },
    visible_preserve_value: false,
  }),
]);
const toggle = createFormEngine({
  schema: toggleSchema,
  initialValues: { switcher: 1, value: 'secret' },
});
toggle.eval();
toggle.setValue('switcher', 0);
toggle.setValue('switcher', 1);
assert.equal(toggle.getState().values.value, null);

const schema = formSchema([
  numericField('switcher'),
  calculatedField('sum', "REPEATABLESUM($rows, 'amount')"),
  {
    ...repeatableSection('rows', [
      numericField('amount', { visible_preserve_value: false }),
      textField('keep'),
      repeatableSection('deep', [textField('secret', { visible_preserve_value: false })]),
    ]),
    visible: false,
    visible_conditions: { field_id: 'switcher', operator: 'equal_to', value: 1 },
  },
]);
const input = {
  values: { switcher: 0 },
  repeatable: {
    rows: [
      {
        id: 0,
        values: { amount: 5, keep: 'keep' },
        custom: { ok: true },
        repeatable: { deep: [{ id: 'd', values: { secret: 'secret' } }] },
      },
    ],
  },
};
const original = structuredClone(input);
const evaluator = createRecordEvaluator({ schema });
const scoped = await evaluator.evaluateScope(input);
assert.equal(scoped.state.values.sum, 0);
assert.equal(scoped.clearedFields.length, 2);
assert.deepEqual(input, original);
const readonly = await evaluator.evaluateScope(input, { interactionMode: 'readonly' });
assert.deepEqual(readonly.clearedFields, []);
const child = await evaluator.evaluateScope(input, {
  instancePath: [{ repeatableKey: 'rows', instanceId: 0, index: 0, identity: 'id' }],
});
assert.equal(child.state.values.amount, null);
assert.equal(child.clearedFields.length, 2);
const result = await evaluator.prepareSubmission(input);
assert.equal(result.snapshot.repeatable.rows[0].values.amount, null);
assert.deepEqual(result.snapshot.repeatable.rows[0].custom, { ok: true });
assert.equal(result.snapshot.repeatable.rows[0].id, 0);
const stored = createStructuredRecord(result.snapshot, flattenFields(schema.form.elements), {
  originalElements: schema.form.elements,
});
assert.equal(stored.form_values.rows[0].form_values.amount, null);
assert.equal(stored.form_values.rows[0].form_values.keep, 'keep');
const abort = new AbortController();
abort.abort();
assert.equal(
  (await evaluator.prepareSubmission(input, { signal: abort.signal })).status,
  'cancelled'
);
assert.deepEqual(input, original);

const strictSchema = formSchema([
  textField('hidden', { visible: false, required: true }),
  {
    ...repeatableSection('rows', [
      numericField('amount'),
      textField('required', { required: true }),
    ]),
    visible: false,
  },
]);
const strictInput = {
  values: { hidden: 9 },
  repeatable: { rows: [{ id: 0, values: { amount: 'bad' } }] },
};
const strictEvaluator = createRecordEvaluator({ schema: strictSchema });
assert.equal((await strictEvaluator.prepareSubmission(strictInput)).status, 'ready');
const strict = await strictEvaluator.prepareSubmission(strictInput, { validateHiddenValues: true });
assert.equal(strict.status, 'blocked');
assert.equal(strict.validationSummary.generalErrors.length, 2);
assert.equal(strict.validationSummary.requiredFieldErrors.length, 0);
assert.equal(
  validateSubmission({
    schema: strictSchema,
    snapshot: strict.snapshot,
    validateHiddenValues: true,
  }).generalErrors.length,
  2
);
assert.equal(
  (
    await strictEvaluator.prepareSubmission(strictInput, {
      validateHiddenValues: true,
      intent: 'draft',
    })
  ).eligible,
  true
);
assert.equal(
  (await strictEvaluator.prepareSubmission(strictInput, { validateHiddenValues: 'yes' })).status,
  'failed'
);
assert.throws(
  () =>
    validateSubmission({
      schema: strictSchema,
      snapshot: strict.snapshot,
      validateHiddenValues: 'yes',
    }),
  /boolean/
);
const reviewSchema = formSchema(
  [numericField('tax'), repeatableSection('rows', [calculatedField('total', 'SETRESULT($tax)')])],
  { repeatable_recalculation: 'confirm' }
);
const reviewer = createRecordEvaluator({ schema: reviewSchema });
const source = { values: { tax: 5 }, repeatable: { rows: [{ id: 0, values: { total: 1 } }] } };
const pending = await reviewer.prepareSubmission(source, { validateHiddenValues: true });
assert.equal(pending.status, 'requires_decision');
assert.equal(
  (
    await reviewer.prepareSubmission(source, {
      decision: { reviewId: pending.reviewId, action: 'refresh' },
    })
  ).issues[0].code,
  'stale_review'
);
console.log(
  'Runtime types, retention, scope isolation, strict hidden validation and review policy passed.'
);

// All supported input families clear to the same live sentinel; output producers retain
// their established empty representation rather than deleting rows or remote assets.
const { FIELD_SPECS } = await import('../src/index.js');
const samples = {
  SingleChoiceField: { choice: [{ value: 'yes', label: 'Yes' }], other: [] },
  MultiChoiceField: { choices: [{ value: 'yes', label: 'Yes' }], other: [] },
  BooleanField: { choice: [{ value: 'yes', label: 'Yes' }], other: [] },
  PhotoField: [{ photo_id: 'photo', url: 'https://example.test/photo' }],
  VideoField: [{ video_id: 'video', duration: 5 }],
  SignatureField: { signature_id: 'signature', data: 'local fixture' },
  FormLinkField: [{ record_id: 'linked-record' }],
};
for (const [type, value] of Object.entries(samples)) {
  const attributes = FIELD_SPECS[type].attributes;
  const source = {
    ...commonInputAttributes,
    type,
    key: 'value',
    data_name: 'value',
    label: 'Value',
    visible: false,
    visible_preserve_value: false,
    choices: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
    ],
    allow_other: false,
    is_searchable: false,
    is_searchable_mode: null,
    third_option_enabled: false,
    agreement_text: null,
    min_length: null,
    max_length: null,
    allow_creating_records: false,
    allow_existing_records: true,
    allow_multiple_records: false,
    allow_updating_records: false,
    form_id: 'linked-form',
    record_conditions: null,
    record_defaults: null,
  };
  const field = Object.fromEntries(Object.entries(source).filter(([name]) => name in attributes));
  const schema = formSchema([field]);
  const original = { values: { value } };
  const prepared = await createRecordEvaluator({ schema }).prepareSubmission(original);
  assert.equal(prepared.status, 'ready', `${type}: ${JSON.stringify(prepared.issues)}`);
  assert.equal(prepared.snapshot.values.value, null);
  assert.deepEqual(original.values.value, value);
  const stored = createStructuredRecord(prepared.snapshot, [field]);
  assert.deepEqual(stored.form_values.value, FIELD_SPECS[type].outputProducer(field, null));
}
const isolatedInput = structuredClone(input);
isolatedInput.repeatable.rows.push({
  id: 'sibling',
  values: { amount: 7, keep: 'sibling secret' },
  repeatable: { deep: [{ id: 's', values: { secret: 'untouched' } }] },
});
const isolated = await createRecordEvaluator({ schema }).evaluateScope(isolatedInput, {
  instancePath: [{ repeatableKey: 'rows', instanceId: 0, index: 0, identity: 'id' }],
});
assert.ok(isolated.clearedFields.every((field) => field.instancePath[0].instanceId === 0));
assert.equal(isolatedInput.repeatable.rows[1].values.amount, 7);
const section = {
  ...repeatableSection('container', [textField('value', { visible_preserve_value: false })]),
  type: 'Section',
  display: 'inline',
  visible: false,
};
delete section.location_enabled;
delete section.location_required;
const sectionEngine = createFormEngine({
  schema: formSchema([section]),
  initialValues: { value: 'clear' },
});
sectionEngine.eval();
assert.equal(sectionEngine.getState().values.value, null);
let stubborn;
stubborn = createFormEngine({
  schema: formSchema([
    textField('secret', { visible: false, visible_preserve_value: false }),
    calculatedField('out', 'SETRESULT(refill())'),
  ]),
  helpers: {
    refill() {
      stubborn.getState().values.secret = 'restored';
      return 1;
    },
  },
});
assert.throws(
  () => stubborn.eval(),
  (error) => error.code === 'hidden_value_retention_failed'
);
console.log(
  'Media/link empties, sibling isolation, hidden sections and non-settling evaluation passed.'
);

const emptyRowSchema = formSchema([
  repeatableSection('rows', [
    textField('value', { visible: false, visible_preserve_value: false }),
  ]),
]);
const emptyRowResult = await createRecordEvaluator({ schema: emptyRowSchema }).prepareSubmission({
  values: {},
  repeatable: { rows: [{ id: 0, values: { value: 'clear' } }] },
});
const emptyRecord = createStructuredRecord(
  emptyRowResult.snapshot,
  flattenFields(emptyRowSchema.form.elements),
  { originalElements: emptyRowSchema.form.elements }
);
assert.equal(emptyRecord.form_values.rows.length, 1);
assert.equal(emptyRecord.form_values.rows[0].id, 0);
assert.equal(emptyRecord.form_values.rows[0].form_values.value, null);

for (const action of ['retain', 'refresh']) {
  const schema = formSchema(
    [
      numericField('tax'),
      repeatableSection('rows', [
        numericField('amount', { visible: false, visible_preserve_value: false }),
        calculatedField('total', 'SETRESULT(($amount ?? 0) + $tax)'),
      ]),
    ],
    { repeatable_recalculation: 'confirm' }
  );
  const evaluator = createRecordEvaluator({ schema });
  const source = {
    values: { tax: 5 },
    repeatable: { rows: [{ id: 0, values: { amount: 3, total: 9 } }] },
  };
  const pending = await evaluator.prepareSubmission(source, { allowRetain: true });
  assert.equal(pending.status, 'requires_decision');
  const chosen = await evaluator.prepareSubmission(source, {
    allowRetain: true,
    decision: { reviewId: pending.reviewId, action },
  });
  assert.equal(chosen.status, 'ready');
  assert.equal(chosen.snapshot.repeatable.rows[0].values.amount, null);
  assert.equal(chosen.snapshot.repeatable.rows[0].values.total, action === 'retain' ? 9 : 5);
  assert.equal(source.repeatable.rows[0].values.amount, 3);
}

const reported = [];
const diagnosticEngine = createFormEngine({
  schema: formSchema([
    textField('transient', { visible: false, visible_preserve_value: false }),
    calculatedField('out', 'SETRESULT($transient == null ? 1 : fail())'),
  ]),
  initialValues: { transient: 'clear' },
  helpers: {
    fail() {
      throw new Error('Temporary input');
    },
  },
  diagnostics: { console: false },
  onDiagnostics: (snapshot) => reported.push(snapshot),
});
diagnosticEngine.eval();
assert.equal(diagnosticEngine.getState().values.out, 1);
assert.deepEqual(diagnosticEngine.getDiagnostics(), []);
assert.deepEqual(reported, [[]]);

const withHiddenHandler = structuredClone(strictSchema);
withHiddenHandler.form.events = {
  code: "ON('validate-repeatable', 'rows', function() { INVALID('Hidden handler must not run'); });",
};
const hiddenHandlerResult = await createRecordEvaluator({
  schema: withHiddenHandler,
}).prepareSubmission(strictInput, { validateHiddenValues: true, managedEvents: true });
assert.equal(hiddenHandlerResult.validationSummary.generalErrors.length, 2);
assert.deepEqual(hiddenHandlerResult.validationSummary.scopeIssues, []);
const cancelledAfterClear = new AbortController();
const cancelSource = { values: { value: 'secret' } };
const cancelling = createRecordEvaluator({
  schema: formSchema([
    textField('value', { visible: false, visible_preserve_value: false }),
    calculatedField('output', 'SETRESULT(observe($value))'),
  ]),
  helpers: {
    observe(value) {
      if (value === null) cancelledAfterClear.abort();
      return 1;
    },
  },
});
assert.equal(
  (await cancelling.prepareSubmission(cancelSource, { signal: cancelledAfterClear.signal })).status,
  'cancelled'
);
assert.deepEqual(cancelSource, { values: { value: 'secret' } });
