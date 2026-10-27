import assert from 'node:assert/strict';
import {
  FIELD_SPECS,
  getBuiltinDefinitions,
  createFormEngine,
  createRecordEvaluator,
  validateSchema,
  createStructuredRecord,
  validateSubmission,
  isFieldValueEmpty,
} from '../src/index.js';
import {
  BUILTIN_CASES,
  SPECIAL_BUILTINS,
  FIELD_CASES,
  fixtureFieldTypes,
  builtinFixture,
  fieldFixture,
  auditField,
  attachAuditEvents,
} from './fixtures/consumer-compatibility.js';
assert.deepEqual(
  [...BUILTIN_CASES.map(([name]) => name), ...Object.keys(SPECIAL_BUILTINS)].sort(),
  getBuiltinDefinitions()
    .map((x) => x.name)
    .sort(),
  'Every builtin needs an explicit audit case'
);
assert.deepEqual(
  Object.keys(FIELD_CASES).sort(),
  Object.keys(FIELD_SPECS).sort(),
  'Every field type needs an explicit audit case'
);
assert.deepEqual(
  fixtureFieldTypes(fieldFixture(FIELD_SPECS).schema),
  Object.keys(FIELD_SPECS).sort(),
  'Every field type must occur in the actual schema'
);
const report = [];
for (const security of [undefined, { mode: 'safe' }]) {
  const fixture = builtinFixture(FIELD_SPECS);
  validateSchema(fixture.schema.form);
  const evaluated = await createRecordEvaluator({
    schema: fixture.schema,
    security,
    diagnostics: { console: false },
  }).evaluate(fixture.snapshot, { mode: 'refresh' });
  for (const [name, , expected] of BUILTIN_CASES)
    assert.deepEqual(
      evaluated.snapshot.values['builtin_' + name.toLowerCase()],
      expected,
      name + ' calculation'
    );
  for (const [name, expression, expected] of BUILTIN_CASES.filter(([name]) =>
    getBuiltinDefinitions()
      .find((x) => x.name === name)
      .contexts.includes('event')
  )) {
    const schema = structuredClone(fixture.schema);
    schema.form.elements.push(auditField(FIELD_SPECS, 'TextField', 'event_result'));
    schema.form.events = {
      code: `ON('change', 'amount', function() { SETVALUE('event_result', ${expression}); });`,
    };
    const engine = createFormEngine({
      schema,
      security,
      initialValues: fixture.snapshot.values,
      diagnostics: { console: false },
    });
    assert.deepEqual(
      engine.triggerDetailed('change', 'amount').operations[0]?.params.valueToSet,
      expected,
      name + ' event'
    );
  }
  const form = fieldFixture(FIELD_SPECS);
  validateSchema(form.schema.form);
  const original = structuredClone(form.snapshot);
  const prepared = await createRecordEvaluator({
    schema: form.schema,
    security,
    diagnostics: { console: false },
  }).prepareSubmission(form.snapshot);
  assert.equal(prepared.status, 'ready', JSON.stringify(prepared.executionIssues));
  assert.deepEqual(form.snapshot, original);
  const saved = createStructuredRecord(
    prepared.snapshot,
    form.schema.form.elements,
    { fieldKeyMode: 'data-name' },
    0
  );
  assert.equal(saved.id, 0);
  assert.equal(saved.form_values.rows[0].id, 0);
  assert.equal(saved.form_values.signature.signature_id, 'sig');
  assert.equal(saved.form_values.photos[0].asset_id, 'asset-photo');
  assert.deepEqual(saved.form_values.links, [{ record_id: '0' }]);
  const eventFields = fieldFixture(FIELD_SPECS);
  const literalText = '</script><script>"\'\\\n\r\t\b\f\0\u2028\u2029😀';
  eventFields.snapshot.values.text = literalText;
  eventFields.snapshot.values.photos[0][literalText] = literalText;
  attachAuditEvents(FIELD_SPECS, eventFields);
  assert.doesNotMatch(eventFields.schema.form.events.code, /[<>\u2028\u2029]/u);
  const fieldEvents = createFormEngine({
    schema: eventFields.schema,
    initialValues: eventFields.snapshot.values,
    security,
    diagnostics: { console: false },
  });
  for (const [stage, values] of [
    [1, eventFields.changed],
    [2, eventFields.cleared],
    [0, eventFields.snapshot.values],
  ]) {
    fieldEvents.getState().values.stage = stage;
    const result = fieldEvents.triggerDetailed('change', 'stage');
    assert.deepEqual(result.issues, []);
    assert.deepEqual(
      result.operations,
      Object.entries(values)
        .filter(([name]) => !['section_note', 'stage'].includes(name))
        .map(([fieldDataName, valueToSet]) => ({
          type: 'FIELD_OPERATION',
          operation: 'SETVALUE',
          params: { fieldDataName, valueToSet },
        })),
      'Generated field events preserve literal values at stage ' + stage
    );
  }
  assert.equal(
    isFieldValueEmpty({ type: 'SingleChoiceField' }, { choice: [], other: [{ label: '' }] }),
    true
  );
  assert.equal(isFieldValueEmpty({ type: 'CalculatedField' }, false), false);
  const special = attachAuditEvents(FIELD_SPECS, builtinFixture(FIELD_SPECS), 'builtins');
  const source = createFormEngine({
    schema: special.schema,
    initialValues: special.snapshot.values,
    security,
    diagnostics: { console: false },
  });
  const changed = source.triggerDetailed('change', 'amount');
  assert.deepEqual(changed.issues, []);
  assert.equal(changed.operations.filter((x) => x.operation === 'ALERT').length, 1);
  assert.equal(
    changed.operations.find((x) => x.params?.fieldDataName === 'event_trace').params.valueToSet,
    'x'
  );
  source.getState().values.amount = -1;
  assert.deepEqual(source.triggerDetailed('validate-record').validationIssues, [
    { message: 'Root amount is invalid', instancePath: [] },
  ]);
  const path = [{ repeatableKey: 'rows', instanceId: 0, index: 0, identity: 'id' }];
  const row = createFormEngine({
    schema: special.schema,
    initialValues: { ...special.snapshot.values, cost: -1 },
    security,
    eventScope: { instancePath: path },
    diagnostics: { console: false },
  });
  assert.deepEqual(row.triggerDetailed('validate-repeatable', 'rows').validationIssues, [
    { message: 'Row cost is invalid', instancePath: path },
  ]);
  const unsupported = {
    form: {
      name: 'Reserved builtin',
      elements: [
        auditField(FIELD_SPECS, 'CalculatedField', 'reserved', { calculate: 'FORM()' }),
        auditField(FIELD_SPECS, 'NumericField', 'input'),
      ],
    },
  };
  const reserved = createFormEngine({
    schema: unsupported,
    security,
    diagnostics: { console: false },
  });
  reserved.eval();
  assert.equal(reserved.getState().values.reserved, null);
  assert.match(reserved.getDiagnostics()[0].message, /not yet implemented/);
  assert.deepEqual(reserved.getState().errors, {});
  unsupported.form.events = { code: "ON('change','input',function(){FORM();});" };
  const failed = createFormEngine({
    schema: unsupported,
    security,
    diagnostics: { console: false },
  }).triggerDetailed('change', 'input');
  assert.equal(failed.issues.length, 1);
  assert.match(failed.issues[0].message, /not yet implemented/);
  const hidden = fieldFixture(FIELD_SPECS);
  hidden.schema.form.elements.find((f) => f.data_name === 'section').visible = false;
  hidden.schema.form.elements.find((f) => f.data_name === 'section').elements[0].required = true;
  hidden.snapshot.values.section_note = null;
  assert.equal(
    validateSubmission({
      schema: hidden.schema,
      snapshot: (
        await createRecordEvaluator({ schema: hidden.schema, security }).evaluate(hidden.snapshot)
      ).snapshot,
    }).hasErrors,
    false
  );
  const readonly = fieldFixture(FIELD_SPECS);
  Object.assign(
    readonly.schema.form.elements.find((f) => f.data_name === 'text'),
    { required: true, read_only: true }
  );
  readonly.snapshot.values.text = null;
  assert.equal(validateSubmission(readonly).hasErrors, true);
  report.push({
    security: security?.mode || 'trusted',
    builtins: BUILTIN_CASES.length,
    fields: Object.keys(FIELD_CASES).length,
  });
}
console.log(JSON.stringify(report));
