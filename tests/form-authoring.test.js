import assert from 'node:assert/strict';

import {
  applyFormMutationBatch,
  getFormAICloudPolicy,
  getFormAuthoringContext,
  getFormSchemaRevision,
  validateFormAuthoringSchema,
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

function singleChoiceField(dataName) {
  return {
    type: 'SingleChoiceField',
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
    allow_other: false,
    choices: [
      { value: 'loreto', label: 'Loreto' },
      { value: 'recanati', label: 'Recanati' },
    ],
    supporting_image: false,
    supporting_image_path: null,
    supporting_image_display: null,
    is_searchable: false,
    is_searchable_mode: 'default',
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
assert.equal(context.contractVersion, 3);
assert.equal(context.schema.form.elements.length, 2);
assert.equal(context.revision, revision);
assert.ok(context.fieldSpecs.TextField);
assert.ok(context.calculationBuiltins.some((builtin) => builtin.name === 'SETRESULT'));
assert.deepEqual(context.calculationGuidance.preferenceOrder, [
  'direct-expression',
  'builtin-expression',
  'multiline-javascript',
]);
assert.equal(context.calculationGuidance.multilineResult.builtin, 'SETRESULT');
assert.equal(context.calculationGuidance.multilineResult.requiredCalls, 1);
assert.equal(context.calculationGuidance.multilineResult.placement, 'final-statement');
assert.deepEqual(context.calculationGuidance.nonPreferredPatterns, ['iife']);
assert.equal(context.calculationGuidance.examples.builtin, 'IF($eligible, $amount, 0)');
assert.match(context.calculationGuidance.examples.multiline, /SETRESULT\(age\);$/);
assert.ok(context.eventTypes.includes('change'));
assert.equal(context.eventGuidance.choiceValues.single.builtin, 'CHOICEVALUE');
assert.deepEqual(context.eventGuidance.choiceValues.single.fieldTypes, [
  'SingleChoiceField',
  'BooleanField',
]);
assert.equal(context.eventGuidance.choiceValues.multiple.builtin, 'CHOICEVALUES');
assert.equal(context.eventGuidance.conditionalMappings.explicitNamedCases, true);
assert.equal(context.eventGuidance.conditionalMappings.explicitFallback, true);
assert.match(context.eventGuidance.examples.conditionalChoiceMapping, /CHOICEVALUE/);
assert.match(context.eventGuidance.examples.conditionalChoiceMapping, /recanati/);

assert.deepEqual(getFormAICloudPolicy(source), {
  allowCloud: false,
  requiresConsent: true,
  cloudBlockers: [{ scope: 'field', key: 'first_name' }],
  consentReasons: [{ scope: 'form' }],
});

const sourceValidation = validateFormAuthoringSchema({ schema: source });
assert.equal(sourceValidation.valid, true, JSON.stringify(sourceValidation.diagnostics));
assert.equal(sourceValidation.revision, revision);

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

const choiceSource = structuredClone(source);
choiceSource.form.elements.push(singleChoiceField('birth_town'));
const invalidChoiceComparison = applyFormMutationBatch({
  schema: choiceSource,
  baseRevision: getFormSchemaRevision(choiceSource),
  operations: [
    {
      op: 'setFormEventCode',
      code: `ON('change', 'birth_town', function () {
        SETVALUE('first_name', IF($birth_town === 'loreto', 'Hooola!', 'Ciaooo'));
      });`,
    },
  ],
});
assert.equal(invalidChoiceComparison.valid, false);
assert.ok(
  invalidChoiceComparison.diagnostics.some(
    (issue) => issue.code === 'choice_value_accessor_required' && issue.source === 'form-events'
  )
);
const invalidChoiceValidation = validateFormAuthoringSchema({
  schema: {
    ...choiceSource,
    form: {
      ...choiceSource.form,
      events: {
        code: `ON('change', 'birth_town', function () {
          SETVALUE('first_name', IF($birth_town === 'loreto', 'Hooola!', 'Ciaooo'));
        });`,
      },
    },
  },
});
assert.equal(invalidChoiceValidation.valid, false);
assert.ok(
  invalidChoiceValidation.diagnostics.some(
    (issue) => issue.code === 'choice_value_accessor_required'
  )
);

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

const malformedRename = applyFormMutationBatch({
  schema: operationSchema,
  baseRevision: getFormSchemaRevision(operationSchema),
  operations: [{ op: 'updateForm', patch: { name: 'Must not be silently ignored' } }],
});
assert.equal(malformedRename.valid, false, 'a malformed rename must not report success');
assert.equal(malformedRename.schema, null);
assert.match(malformedRename.diagnostics[0].message, /changes/);
assert.equal(operationSchema.form.name, 'Operations');

const updateFormContract = context.mutationOperationCatalog?.find(
  (entry) => entry.op === 'updateForm'
);
assert.deepEqual(updateFormContract?.required, ['changes']);
assert.equal(updateFormContract?.parameters.changes.type, 'object');
assert.deepEqual(updateFormContract?.example, {
  op: 'updateForm',
  changes: { name: 'Renamed form' },
});

const validRename = applyFormMutationBatch({
  schema: operationSchema,
  baseRevision: getFormSchemaRevision(operationSchema),
  operations: [updateFormContract.example],
});
assert.equal(validRename.valid, true, JSON.stringify(validRename.diagnostics));
assert.equal(validRename.schema.form.name, 'Renamed form');
assert.equal(operationSchema.form.name, 'Operations');
const idempotentRename = applyFormMutationBatch({
  schema: validRename.schema,
  baseRevision: validRename.revision,
  operations: [updateFormContract.example],
});
assert.equal(idempotentRename.valid, true, 'core accepts valid idempotent operations');
assert.equal(idempotentRename.revision, validRename.revision);
assert.deepEqual(
  context.mutationOperationCatalog.map(({ op }) => op),
  context.mutationOperations
);
updateFormContract.required.push('must-not-leak');
updateFormContract.parameters.changes.type = 'must-not-leak';
const freshContract = getFormAuthoringContext({
  schema: operationSchema,
}).mutationOperationCatalog.find(({ op }) => op === 'updateForm');
assert.deepEqual(freshContract.required, ['changes']);
assert.equal(freshContract.parameters.changes.type, 'object');

for (const operation of [
  { op: 'updateForm', changes: null },
  { op: 'updateForm', changes: [] },
  { op: 'updateForm', changes: {} },
  { op: 'updateForm', changes: { name: 'Good' }, patch: { name: 'Ignored' } },
  { op: 'updateField', fieldKey: 'alpha', patch: { label: 'Ignored' } },
  { op: 'updateField', fieldKey: 'alpha', changes: 'Ignored' },
  { op: 'updateField', fieldKey: 'alpha', changes: {} },
  { op: 'removeField', fieldKey: '' },
  { op: 'moveField', fieldKey: 'gamma', position: { index: 0 } },
  { op: 'moveField', fieldKey: 'gamma', position: { beforeKey: 'alpha', afterKey: 'beta' } },
  { op: 'setTitleField' },
  { op: 'setStatusField', field: false },
  { op: 'setFormEventCode' },
  { op: 'setCalculation', fieldKey: 'alpha' },
  { op: 'addField', field: textField('delta'), parentKey: 42 },
  null,
  [],
]) {
  const rejected = applyFormMutationBatch({
    schema: operationSchema,
    baseRevision: getFormSchemaRevision(operationSchema),
    operations: [{ op: 'updateForm', changes: { name: 'Must roll back' } }, operation],
  });
  assert.equal(
    rejected.valid,
    false,
    `invalid operation must be rejected: ${JSON.stringify(operation)}`
  );
  assert.equal(rejected.schema, null);
  assert.equal(rejected.diagnostics[0].operationIndex, 1);
  assert.equal(operationSchema.form.name, 'Operations', 'invalid batches must stay atomic');
}

console.log('form authoring tests passed');
