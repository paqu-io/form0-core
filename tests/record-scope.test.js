import assert from 'node:assert/strict';
import { createRecordEvaluator, SAFE_SECURITY_CONFIG } from '../src/index.js';
import {
  numericField,
  calculatedField,
  repeatableSection,
  formSchema,
  textField,
} from './helpers/calculation-fixtures.js';

const segment = (id, index = 0, key = 'projects') => ({
  repeatableKey: key,
  instanceId: id,
  index,
  identity: id == null ? 'position' : 'id',
});
const schema = formSchema([
  numericField('multiplier'),
  calculatedField('grand_total', "REPEATABLESUM($projects, 'subtotal')"),
  repeatableSection('projects', [
    numericField('surcharge'),
    calculatedField('subtotal', "REPEATABLESUM($tasks, 'cost') + $surcharge"),
    textField('note', { required: true }),
    repeatableSection('tasks', [
      numericField('base_cost'),
      calculatedField('cost', '$base_cost * $multiplier'),
    ]),
  ]),
]);
const source = () => ({
  values: { multiplier: 2, grand_total: 130 },
  repeatable: {
    projects: [
      {
        id: 0,
        values: { surcharge: 5, subtotal: 30, note: '' },
        repeatable: {
          tasks: [
            { id: 1, values: { base_cost: 10, cost: 10 } },
            { id: 2, values: { base_cost: 20, cost: 20 } },
          ],
        },
      },
      {
        id: 'P2',
        values: { surcharge: 0, subtotal: 100 },
        repeatable: { tasks: [{ id: 1, values: { base_cost: 100, cost: 100 } }] },
      },
    ],
  },
});
let count = 0;
for (const security of [undefined, SAFE_SECURITY_CONFIG]) {
  const evaluator = createRecordEvaluator({ schema, security, diagnostics: { console: false } });
  const input = source(),
    before = structuredClone(input);
  const result = await evaluator.evaluateScope(input, { instancePath: [segment(0, 99)] });
  assert.equal(result.status, 'evaluated');
  assert.equal(result.state.values.subtotal, 35);
  assert.equal(result.snapshot, undefined);
  assert.equal(result.instancePath[0].index, 0);
  assert.deepEqual(
    result.changes.map((c) => [c.before, c.after]),
    [[30, 35]]
  );
  assert.equal(result.validationSummary.requiredFieldErrors[0].fieldName, 'note');
  assert.equal(result.validationSummary.orderedIssues.length, 1);
  assert.deepEqual(input, before);
  result.state.values.note = 'detached';
  assert.equal(input.repeatable.projects[0].values.note, '');
  const root = await evaluator.evaluateScope(input);
  assert.equal(root.state.values.grand_total, 130);
  const deep = await evaluator.evaluateScope(input, {
    instancePath: [segment(0), segment(1, 0, 'tasks')],
  });
  assert.equal(deep.state.values.cost, 20);
  assert.equal(input.repeatable.projects[0].repeatable.tasks[0].values.cost, 10);
  const moved = source();
  moved.repeatable.projects.reverse();
  assert.equal(
    (await evaluator.evaluateScope(moved, { instancePath: [segment(0)] })).state.values.subtotal,
    35
  );
  for (const path of [null, {}, [segment('missing')], [segment(false)], [segment(0, -1)]]) {
    const invalid = await evaluator.evaluateScope(input, {
      instancePath: path === null ? 'bad' : path,
    });
    assert.equal(invalid.status, 'failed');
    assert.equal(invalid.issues[0].code, 'invalid_instance_path');
  }
  const positional = source();
  delete positional.repeatable.projects[0].id;
  assert.equal(
    (await evaluator.evaluateScope(positional, { instancePath: [segment(null)] })).state.values
      .subtotal,
    35
  );
  const aborted = new AbortController();
  aborted.abort();
  assert.equal(
    (await evaluator.evaluateScope(input, { signal: aborted.signal })).status,
    'cancelled'
  );
  const captured = source();
  let changed = false;
  const frozen = await evaluator.evaluateScope(captured, {
    instancePath: [segment(0)],
    budgetMs: 0,
    yieldToHost() {
      if (!changed) {
        changed = true;
        captured.repeatable.projects[0].values.surcharge = 999;
        captured.repeatable.projects[0].repeatable.tasks[0].values.cost = 999;
      }
    },
  });
  assert.equal(frozen.state.values.subtotal, 35);
  assert.deepEqual(
    frozen.changes.map((c) => [c.before, c.after]),
    [[30, 35]]
  );
  // Accepted row save changes the parent; cancellation never changes its accepted tree.
  const accepted = source();
  Object.assign(accepted.repeatable.projects[0].values, result.state.values);
  assert.equal((await evaluator.evaluateScope(accepted)).state.values.grand_total, 135);
  assert.equal((await evaluator.evaluateScope(source())).state.values.grand_total, 130);
  count++;
}
console.log(`Scoped record evaluation: ${count} TRUSTED/SAFE matrices passed.`);

const hiddenSchema = structuredClone(schema);
hiddenSchema.form.elements[2].visible = false;
const hidden = await createRecordEvaluator({ schema: hiddenSchema }).evaluateScope(source(), {
  instancePath: [segment(0)],
});
assert.equal(hidden.validationSummary.hasErrors, false);
assert.equal(hidden.state.required.note, true);

// Scope evaluation and exact serialization agree on explicit root identity zero.
const { createStructuredRecord } = await import('../src/index.js');
assert.equal(createStructuredRecord({ values: {} }, [], { mainRecordId: 0 }).id, 0);
assert.equal(createStructuredRecord({ values: {} }, [], {}, 0).id, 0);
assert.equal(
  createStructuredRecord({ values: {} }, [], { mainRecordId: '' }, 'fallback').id,
  'fallback'
);

// Uneven deep ancestry uses current supplied root reads and accepted values everywhere else.
let deepElements = [numericField('amount'), calculatedField('cost', '$amount * $factor')];
let deepRows = {};
for (let level = 21; level >= 0; level--) {
  deepElements = [repeatableSection(`level_${level}`, deepElements)];
  deepRows = {
    [`level_${level}`]: [
      { id: level, values: level === 21 ? { amount: 7, cost: 7 } : {}, repeatable: deepRows },
    ],
  };
}
const deepSchema = formSchema([
  numericField('factor'),
  calculatedField('total', "REPEATABLESUM($level_21, 'cost')"),
  ...deepElements,
  repeatableSection('empty_branch', [textField('unused')]),
]);
const deepInput = { values: { factor: 2, total: 7 }, repeatable: deepRows };
const deepEvaluator = createRecordEvaluator({
  schema: deepSchema,
  diagnostics: { console: false },
});
const deepPath = Array.from({ length: 22 }, (_, level) => segment(level, 0, `level_${level}`));
const deepScope = await deepEvaluator.evaluateScope(deepInput, { instancePath: deepPath });
assert.equal(deepScope.state.values.cost, 14);
assert.equal((await deepEvaluator.evaluateScope(deepInput)).state.values.total, 7);
assert.equal(deepInput.repeatable.level_0[0].id, 0);

// Automatic submit captures every input before yielding even without a retained-source copy.
for (const security of [undefined, SAFE_SECURITY_CONFIG]) {
  const input = source();
  input.repeatable.projects.forEach((row) => {
    row.values.note = 'Accepted';
  });
  const evaluator = createRecordEvaluator({ schema, security, diagnostics: { console: false } });
  let changed = false;
  const prepared = await evaluator.prepareSubmission(input, {
    budgetMs: 0,
    yieldToHost: async () => {
      if (changed) return;
      changed = true;
      input.values.multiplier = 9;
      input.repeatable.projects[0].repeatable.tasks[0].values.base_cost = 999;
    },
  });
  assert.equal(changed, true);
  assert.equal(prepared.eligible, true);
  assert.equal(prepared.snapshot.values.multiplier, 2);
  assert.equal(prepared.snapshot.values.grand_total, 265);
  assert.equal(prepared.snapshot.repeatable.projects[0].repeatable.tasks[0].values.cost, 20);
  assert.equal(input.values.multiplier, 9);
}
