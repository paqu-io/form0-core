import assert from 'node:assert/strict';
import { createRecordEvaluator, flattenFields, SAFE_SECURITY_CONFIG } from '../src/index.js';
import { ContextResolver } from '../src/engine/context-resolver.js';
import {
  complexRecordFixture,
  expectedComplexSnapshot,
  checkComplexSnapshot,
} from './helpers/complex-record-fixture.js';

const fixture = complexRecordFixture(200);
const fields = flattenFields(fixture.schema.form.elements);
const counts = fields.reduce((counts, field) => {
  counts[field.type] = (counts[field.type] || 0) + 1;
  return counts;
}, {});
assert.deepEqual(counts, {
  NumericField: 180,
  CalculatedField: 90,
  TextField: 90,
  Section: 9,
  RepeatableSection: 8,
});
let leaves = 0;
function countLeaves(rule) {
  if (!rule) return;
  if (rule.field_id) leaves++;
  else for (const branch of Object.values(rule)) branch.forEach(countLeaves);
}
for (const field of fields)
  for (const property of ['visible_conditions', 'required_conditions', 'read_only_conditions'])
    countLeaves(field[property]);
assert.equal(leaves, fixture.dimensions.conditionLeaves);

let checks = 0;
const resolutionsByMode = new Map();
for (const security of [undefined, SAFE_SECURITY_CONFIG]) {
  for (const size of [200, 2000]) {
    const { schema, snapshot, dimensions } = complexRecordFixture(size, { countCalls: true });
    const original = structuredClone(snapshot);
    let calls = 0;
    let accessResolutions = 0;
    const resolvers = new Set();
    const originalResolve = ContextResolver.prototype.resolveFieldAccess;
    ContextResolver.prototype.resolveFieldAccess = function (...args) {
      accessResolutions++;
      resolvers.add(this);
      return originalResolve.apply(this, args);
    };
    try {
      const evaluator = createRecordEvaluator({
        schema,
        security,
        diagnostics: { console: false },
        helpers: { countCall: (value) => (calls++, value) },
      });
      const result = await evaluator.prepareSubmission(snapshot);
      assert.equal(result.status, 'ready');
      assert.deepEqual(result.diagnostics, []);
      assert.deepEqual(result.validationSummary.orderedIssues, []);
      assert.equal(
        checkComplexSnapshot(result.snapshot, expectedComplexSnapshot(snapshot, 'refresh')),
        size
      );
      assert.equal(calls, dimensions.refreshCalculationTasks);
      const firstResolutions = accessResolutions;
      const mode = security?.mode ?? 'trusted';
      if (size === 200) resolutionsByMode.set(mode, firstResolutions);
      else assert.equal(firstResolutions, resolutionsByMode.get(mode));
      // A second call must reuse schema ownership, and accepted mode executes only ten root fields.
      const accepted = await evaluator.evaluate(snapshot, { mode: 'accepted' });
      assert.equal(
        checkComplexSnapshot(accepted.snapshot, expectedComplexSnapshot(snapshot, 'accepted')),
        size
      );
      assert.equal(calls, dimensions.refreshCalculationTasks + 10);
      assert.equal(resolvers.size, 1);
      assert.equal(accessResolutions, firstResolutions);
      assert.deepEqual(snapshot, original);
      assert.equal(result.snapshot.repeatable.projects[0].visible.projects_details, false);
      assert.equal(result.snapshot.repeatable.projects[0].visible.projects_t5, true);
      assert.equal(result.snapshot.repeatable.projects[0].required.projects_t5, true);
      assert.equal(result.snapshot.repeatable.projects[0].read_only.projects_t0, true);
    } finally {
      ContextResolver.prototype.resolveFieldAccess = originalResolve;
    }
    checks++;
  }
  const { schema, snapshot } = complexRecordFixture(200);
  const evaluator = createRecordEvaluator({ schema, security, diagnostics: { console: false } });
  const deepest =
    snapshot.repeatable.projects[0].repeatable.tasks[0].repeatable.visits[0].repeatable.checks[0]
      .repeatable.samples[0].repeatable.readings[0];
  deepest.values.readings_n0 = 20;
  deepest.values.readings_t0 = '';
  const log = console.log;
  let result;
  try {
    console.log = () => {};
    result = await evaluator.prepareSubmission(snapshot, { managedEvents: true });
  } finally {
    console.log = log;
  }
  assert.equal(result.status, 'blocked');
  assert.equal(result.validationSummary.requiredFieldErrors.length, 1);
  assert.equal(result.validationSummary.scopeIssues.length, 1);
  assert.equal(result.validationSummary.requiredFieldErrors[0].fieldName, 'readings_t0');
  assert.equal(result.validationSummary.requiredFieldErrors[0].instancePath.length, 6);
  assert.deepEqual(
    result.validationSummary.requiredFieldErrors[0].instancePath,
    result.validationSummary.scopeIssues[0].instancePath
  );
  assert.equal(
    checkComplexSnapshot(result.snapshot, expectedComplexSnapshot(snapshot, 'refresh')),
    200
  );
  checks++;
}

// Review selection must remain coherent even when a broad tree contains downward dependencies.
{
  const { schema, snapshot } = complexRecordFixture(200);
  schema.form.repeatable_recalculation = 'confirm';
  const evaluator = createRecordEvaluator({ schema, diagnostics: { console: false } });
  const pending = await evaluator.prepareSubmission(snapshot, { allowRetain: true });
  assert.equal(pending.status, 'requires_decision');
  const retained = await evaluator.prepareSubmission(snapshot, {
    allowRetain: true,
    decision: { reviewId: pending.reviewId, action: 'retain' },
  });
  assert.equal(retained.status, 'ready');
  assert.equal(retained.freshness.status, 'pending');
  assert.equal(
    checkComplexSnapshot(retained.snapshot, expectedComplexSnapshot(snapshot, 'accepted')),
    200
  );
  assert.notEqual(retained.snapshot.values.root_c6, pending.proposal.values.root_c6);
  const controller = new AbortController();
  const cancelled = await evaluator.prepareSubmission(snapshot, {
    signal: controller.signal,
    budgetMs: 0,
    yieldToHost: () => controller.abort(),
  });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.snapshot, null);
  checks++;
}
console.log(`${checks} complex record scenarios passed (377 elements, 6 levels, up to 2000 rows).`);
