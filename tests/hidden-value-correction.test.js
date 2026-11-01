import assert from 'node:assert/strict';
import { createRecordEvaluator, createStructuredRecord, flattenFields } from '../src/index.js';
import { formSchema, textField, repeatableSection } from './helpers/calculation-fixtures.js';

const schema = formSchema([
  textField('hidden', { visible: false }),
  textField('shown'),
  repeatableSection('rows', [textField('nested', { visible: false })]),
]);
const evaluator = createRecordEvaluator({ schema });
const source = {
  values: { hidden: 9, shown: 'keep' },
  repeatable: { rows: [{ id: 0, values: { nested: 8 }, metadata: { keep: true } }] },
};
const original = structuredClone(source);
const blocked = await evaluator.prepareSubmission(source, { validateHiddenValues: true });
assert.equal(blocked.validationSummary.generalErrors[0].hidden, true);
const root = await evaluator.correctHiddenValue(source, {
  fieldName: 'hidden',
  instancePath: [],
  value: 'repaired',
});
assert.equal(root.status, 'evaluated');
assert.equal(root.snapshot.values.hidden, 'repaired');
assert.equal(root.snapshot.values.shown, 'keep');
const path = [{ repeatableKey: 'rows', instanceId: 0, index: 0, identity: 'id' }];
const nested = await evaluator.correctHiddenValue(root.snapshot, {
  fieldName: 'nested',
  instancePath: path,
  value: null,
});
assert.equal(nested.snapshot.repeatable.rows[0].values.nested, null);
assert.deepEqual(nested.snapshot.repeatable.rows[0].metadata, { keep: true });
assert.equal(nested.validationSummary.hasErrors, false);
assert.deepEqual(source, original);
const serialized = createStructuredRecord(nested.snapshot, flattenFields(schema.form.elements), {
  originalElements: schema.form.elements,
});
assert.equal(serialized.form_values.rows.length, 1);
assert.equal(serialized.form_values.rows[0].id, 0);
assert.equal(serialized.form_values.rows[0].form_values.nested, null);
assert.equal(Object.hasOwn(serialized, 'preserveEmptyRows'), false);
const invalidObject = { nested: ['invalid'] };
const inspected = await evaluator.inspectHiddenValue(
  { values: { hidden: invalidObject } },
  {
    fieldName: 'hidden',
  }
);
assert.equal(inspected.status, 'inspected');
inspected.value.nested.push('local change');
assert.deepEqual(invalidObject, { nested: ['invalid'] });
const cancellation = new AbortController();
cancellation.abort();
const cancelled = await evaluator.correctHiddenValue(source, {
  fieldName: 'hidden',
  value: null,
  signal: cancellation.signal,
});
assert.equal(cancelled.status, 'cancelled');
assert.deepEqual(source, original);
for (const options of [
  { fieldName: 'shown', value: null },
  { fieldName: 'hidden', value: {} },
  { fieldName: 'hidden', value: null, interactionMode: 'readonly' },
  { fieldName: 'nested', instancePath: [{ ...path[0], instanceId: 'missing' }], value: null },
]) {
  const rejected = await evaluator.correctHiddenValue(source, options);
  assert.equal(rejected.status, 'failed');
  assert.equal(rejected.snapshot, null);
  assert.deepEqual(source, original);
}
console.log(
  'Hidden-value correction repairs or clears only current hidden intrinsic errors and preserves source data.'
);
