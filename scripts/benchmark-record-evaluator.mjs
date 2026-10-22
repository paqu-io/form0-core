import { recordBenchmarkFixture } from '../tests/helpers/record-benchmark.js';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createRecordEvaluator } from '../src/index.js';
import {
  numericField,
  repeatableSection,
  formSchema,
} from '../tests/helpers/calculation-fixtures.js';

const writeMetrics = console.log;
console.log = (...args) => console.error(...args);

const metrics = [];
for (const size of [200, 2000]) {
  let executions = 0;
  let schemaReads = 0;
  const { schema, snapshot, expectedTotal } = recordBenchmarkFixture(size, { countCalls: true });
  // A getter proves that the caller schema is captured once, rather than read for every row/run.
  const captured = schema.form.elements;
  Object.defineProperty(schema.form, 'elements', {
    enumerable: true,
    get() {
      schemaReads++;
      return captured;
    },
  });
  const evaluator = createRecordEvaluator({
    schema,
    helpers: {
      countCall(value) {
        executions++;
        return value;
      },
    },
    diagnostics: { console: false },
  });
  const initialReads = schemaReads;
  const timings = [];
  let maxSchedulingGap = 0;
  let yields = 0;
  const before = process.memoryUsage();
  for (let sample = 0; sample < 7; sample++) {
    const start = performance.now();
    let lastYield = start;
    const result = await evaluator.prepareSubmission(snapshot, {
      yieldToHost: async () => {
        maxSchedulingGap = Math.max(maxSchedulingGap, performance.now() - lastYield);
        yields++;
        await new Promise((resolve) => setTimeout(resolve, 0));
        lastYield = performance.now();
      },
    });
    maxSchedulingGap = Math.max(maxSchedulingGap, performance.now() - lastYield);
    assert.equal(result.status, 'ready');
    assert.equal(result.snapshot.values.total, expectedTotal);
    if (sample >= 2) timings.push(performance.now() - start);
  }
  assert.equal(schemaReads, initialReads);
  assert.equal(executions, size * 5 * 7);
  const p95 = timings.toSorted((a, b) => a - b).at(-1);
  const target = size === 200 ? 250 : 2000;
  const after = process.memoryUsage();
  metrics.push({
    size,
    calculatedFieldsPerRow: 5,
    node: process.version,
    samplesMs: timings.map(Math.round),
    p95Ms: Math.round(p95),
    targetMs: target,
    withinTarget: p95 <= target,
    schemaReads,
    executions,
    yields,
    maxSchedulingGapMs: Math.round(maxSchedulingGap),
    transportBytes: Buffer.byteLength(JSON.stringify(snapshot)),
    heapDeltaBytes: after.heapUsed - before.heapUsed,
    rssBytes: after.rss,
  });
  assert.ok(
    p95 <= target,
    `${size}-row reference-machine performance target exceeded: ${p95.toFixed(1)}ms`
  );
}

{
  const schema = formSchema(
    [numericField('limit'), repeatableSection('rows', [numericField('amount')])],
    {
      events: {
        code: "if ($amount > 80) ON('validate-repeatable', 'rows', function(event) { if ($amount > $limit) INVALID('Amount exceeds limit'); });",
      },
    }
  );
  const evaluator = createRecordEvaluator({ schema, diagnostics: { console: false } });
  const snapshot = {
    values: { limit: 80 },
    repeatable: {
      rows: Array.from({ length: 2000 }, (_, id) => ({
        id,
        values: { amount: id < 1000 ? 100 : 50 },
      })),
    },
  };
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    const result = await evaluator.prepareSubmission(snapshot, { managedEvents: true });
    assert.equal(result.status, 'blocked');
    assert.equal(result.validationSummary.scopeIssues.length, 1000);
    if (i > 0) samples.push(performance.now() - start);
  }
  const p95 = Math.max(...samples);
  metrics.push({
    size: 2000,
    scenario: 'scope-specific managed registration and 1000 custom failures',
    samplesMs: samples.map(Math.round),
    p95Ms: Math.round(p95),
    targetMs: 2000,
    withinTarget: p95 <= 2000,
  });
  assert.ok(p95 <= 2000, `Managed 2000-row target exceeded: ${p95.toFixed(1)}ms`);
}
writeMetrics(
  JSON.stringify(
    {
      metrics,
      notes:
        'Node reference-machine evidence only. Scheduling gaps include indivisible tasks and runtime/GC overhead; individual expressions remain synchronous. Heap delta is not retained-heap or Hermes evidence.',
    },
    null,
    2
  )
);
