import assert from 'node:assert/strict';

import {
  applyFormMutationBatch,
  getFormAICloudPolicy,
  getFormAuthoringContext,
  getFormSchemaRevision,
} from '../src/index.js';

function textField(dataName, extra = {}) {
  return {
    type: 'TextField',
    key: dataName,
    data_name: dataName,
    label: dataName,
    display: 'default',
    description: null,
    description_mode: null,
    required: false,
    required_conditions: null,
    visible: true,
    visible_conditions: null,
    read_only: false,
    read_only_conditions: null,
    default_value: null,
    pattern: null,
    pattern_description: null,
    supporting_image: false,
    supporting_image_path: null,
    supporting_image_display: null,
    ...extra,
  };
}

function calculatedField(dataName, calculate) {
  return {
    type: 'CalculatedField',
    key: dataName,
    data_name: dataName,
    label: dataName,
    display: { style: 'text' },
    description: null,
    description_mode: null,
    required: false,
    visible: true,
    visible_conditions: null,
    read_only: true,
    calculate,
    supporting_image: false,
    supporting_image_path: null,
    supporting_image_display: null,
  };
}

const source = {
  form: {
    name: 'Authoring test',
    description: null,
    ai: { requiresConsent: true },
    title_field: {
      type: 'TitleField',
      key: '@title',
      data_name: 'title',
      label: 'Title',
      display: 'default',
      enabled: true,
      visible: true,
      visible_conditions: null,
      read_only: true,
      read_only_conditions: null,
      elements: ['first_name'],
    },
    events: {
      code: "ON('change', 'first_name', function () { SETVALUE('summary', $first_name); });",
    },
    elements: [
      textField('first_name', { ai: { allowCloud: false } }),
      calculatedField('summary', 'SETRESULT($first_name)'),
    ],
  },
};

const revision = getFormSchemaRevision(source);
assert.equal(revision, getFormSchemaRevision(structuredClone(source)));

const context = getFormAuthoringContext({ schema: source, coreVersion: 'test' });
assert.equal(context.schema.form.elements.length, 2);
assert.equal(context.revision, revision);
assert.ok(context.fieldSpecs.TextField);
assert.ok(context.calculationBuiltins.some((builtin) => builtin.name === 'SETRESULT'));
assert.ok(context.eventTypes.includes('change'));

assert.deepEqual(getFormAICloudPolicy(source), {
  allowCloud: false,
  requiresConsent: true,
  cloudBlockers: [{ scope: 'field', key: 'first_name' }],
  consentReasons: [{ scope: 'form' }],
});

const renamed = applyFormMutationBatch({
  schema: source,
  baseRevision: revision,
  operations: [
    {
      op: 'updateField',
      fieldKey: 'first_name',
      changes: { data_name: 'given_name', label: 'Given name' },
    },
  ],
});
assert.equal(renamed.valid, true, JSON.stringify(renamed.diagnostics));
assert.equal(source.form.elements[0].data_name, 'first_name', 'input must remain immutable');
assert.equal(renamed.schema.form.elements[0].data_name, 'given_name');
assert.equal(renamed.schema.form.elements[1].calculate, 'SETRESULT($given_name)');
assert.match(renamed.schema.form.events.code, /'given_name'/);
assert.match(renamed.schema.form.events.code, /\$given_name/);
assert.deepEqual(renamed.schema.form.title_field.elements, [renamed.schema.form.elements[0].key]);

const stale = applyFormMutationBatch({
  schema: source,
  baseRevision: 'stale',
  operations: [{ op: 'updateForm', changes: { name: 'Nope' } }],
});
assert.equal(stale.valid, false);
assert.equal(stale.diagnostics[0].code, 'stale_schema_revision');

const referencedRemoval = applyFormMutationBatch({
  schema: source,
  baseRevision: revision,
  operations: [{ op: 'removeField', fieldKey: 'first_name' }],
});
assert.equal(referencedRemoval.valid, false);
assert.match(referencedRemoval.diagnostics[0].message, /still referenced/);

const invalidCalculation = applyFormMutationBatch({
  schema: source,
  baseRevision: revision,
  operations: [{ op: 'setCalculation', fieldKey: 'summary', expression: '$missing' }],
});
assert.equal(invalidCalculation.valid, false);
assert.ok(invalidCalculation.diagnostics.some((issue) => issue.code === 'unknown_field_reference'));

const added = applyFormMutationBatch({
  schema: { form: { name: 'Empty', description: null, elements: [] } },
  baseRevision: getFormSchemaRevision({
    form: { name: 'Empty', description: null, elements: [] },
  }),
  operations: [{ op: 'addField', field: textField('email', { key: undefined }) }],
});
assert.equal(added.valid, true, JSON.stringify(added.diagnostics));
assert.ok(added.schema.form.elements[0].key);

const operationSchema = {
  form: {
    name: 'Operations',
    description: null,
    elements: [textField('alpha'), textField('beta'), textField('gamma')],
  },
};
const allOperations = applyFormMutationBatch({
  schema: operationSchema,
  baseRevision: getFormSchemaRevision(operationSchema),
  operations: [
    { op: 'updateForm', changes: { description: 'Updated safely' } },
    { op: 'moveField', fieldKey: 'gamma', position: { beforeKey: 'alpha' } },
    { op: 'setTitleField', field: null },
    { op: 'setStatusField', field: null },
    { op: 'setFormEventCode', code: "ON('load-record', function () {});" },
  ],
});
assert.equal(allOperations.valid, true, JSON.stringify(allOperations.diagnostics));
assert.deepEqual(
  allOperations.schema.form.elements.map((field) => field.data_name),
  ['gamma', 'alpha', 'beta']
);
assert.equal(allOperations.schema.form.description, 'Updated safely');

const removed = applyFormMutationBatch({
  schema: operationSchema,
  baseRevision: getFormSchemaRevision(operationSchema),
  operations: [{ op: 'removeField', fieldKey: 'beta' }],
});
assert.equal(removed.valid, true, JSON.stringify(removed.diagnostics));
assert.equal(removed.schema.form.elements.length, 2);

const rolledBack = applyFormMutationBatch({
  schema: operationSchema,
  baseRevision: getFormSchemaRevision(operationSchema),
  operations: [
    { op: 'updateForm', changes: { name: 'Must not escape' } },
    { op: 'moveField', fieldKey: 'missing' },
  ],
});
assert.equal(rolledBack.valid, false);
assert.equal(rolledBack.schema, null);
assert.equal(operationSchema.form.name, 'Operations');

console.log('form authoring tests passed');
