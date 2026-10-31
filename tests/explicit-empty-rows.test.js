import assert from 'node:assert/strict';
import {
  createRecordEvaluator,
  createStructuredRecord,
  createStructuredRecordAsync,
  flattenFields,
} from '../src/index.js';
import {
  formSchema,
  numericField,
  repeatableSection,
  textField,
} from './helpers/calculation-fixtures.js';

const schema = formSchema([
  repeatableSection('items', [
    textField('product'),
    numericField('quantity'),
    repeatableSection('notes', [textField('note')]),
  ]),
]);
const source = {
  values: {},
  repeatable: {
    items: [
      {
        id: 0,
        values: {},
        created_at_client: '2026-10-31T10:00:00.000Z',
        repeatable: { notes: [{ id: 'note-1', values: {} }] },
      },
    ],
  },
};
const original = structuredClone(source);
const prepared = await createRecordEvaluator({ schema }).prepareSubmission(source);
assert.equal(prepared.status, 'ready');
const fields = flattenFields(schema.form.elements);
const options = { originalElements: schema.form.elements };
for (const serialize of [createStructuredRecord, createStructuredRecordAsync]) {
  const record = await serialize(prepared.snapshot, fields, options);
  assert.equal(record.form_values.items.length, 1, 'An explicitly saved empty row must survive');
  const item = record.form_values.items[0];
  assert.equal(item.id, 0);
  assert.equal(item.created_at_client, source.repeatable.items[0].created_at_client);
  assert.deepEqual(item.form_values, {
    product: null,
    quantity: null,
    notes: [{ ...item.form_values.notes[0], id: 'note-1', form_values: { note: null } }],
  });
  assert.equal(Object.hasOwn(record, 'preserveEmptyRows'), false);
  const absent = await serialize({ values: {}, repeatable: { items: [] } }, fields, options);
  assert.deepEqual(absent.form_values.items, []);
}
assert.deepEqual(source, original);
console.log(
  'Explicit empty rows survive sync/async serialization with null answers and nested IDs.'
);
