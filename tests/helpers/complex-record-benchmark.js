import { checkComplexSnapshot, expectedComplexSnapshot } from './complex-record-fixture.js';

/** Portable Node/browser/Worker timing, with correctness outside the timed interval. */
export async function benchmarkComplexRecords(core, fixture, { samples = 5 } = {}) {
  const beforeHeap = globalThis.performance.memory?.usedJSHeapSize ?? null;
  const startFactory = performance.now();
  const evaluator = core.createRecordEvaluator({
    schema: fixture.schema,
    diagnostics: { console: false },
  });
  const factoryMs = performance.now() - startFactory;
  const timings = [];
  let coldMs;
  let maxSchedulingGapMs = 0;
  let yields = 0;
  let prepared;
  for (let sample = 0; sample < samples + 2; sample++) {
    let lastYield = performance.now();
    const start = lastYield;
    prepared = await evaluator.prepareSubmission(fixture.snapshot, {
      yieldToHost: async () => {
        maxSchedulingGapMs = Math.max(maxSchedulingGapMs, performance.now() - lastYield);
        yields++;
        await new Promise((resolve) => setTimeout(resolve, 0));
        lastYield = performance.now();
      },
    });
    const elapsed = performance.now() - start;
    maxSchedulingGapMs = Math.max(maxSchedulingGapMs, performance.now() - lastYield);
    if (sample === 0) coldMs = elapsed;
    if (sample >= 2) timings.push(elapsed);
    if (prepared.status !== 'ready' || prepared.diagnostics.length)
      throw new Error(`Complex fixture failed: ${JSON.stringify(prepared.issues)}`);
  }
  if (
    checkComplexSnapshot(
      prepared.snapshot,
      expectedComplexSnapshot(fixture.snapshot, 'refresh')
    ) !== fixture.dimensions.rows
  )
    throw new Error('Complex fixture row count changed.');
  const startSerialization = performance.now();
  const outputBytes = new TextEncoder().encode(JSON.stringify(prepared)).length;
  const serializationMs = performance.now() - startSerialization;
  return {
    metrics: {
      ...fixture.dimensions,
      factoryMs,
      coldMs,
      samplesMs: timings,
      warmedMaxMs: Math.max(...timings),
      maxSchedulingGapMs,
      yields,
      inputBytes: new TextEncoder().encode(
        JSON.stringify({ schema: fixture.schema, snapshot: fixture.snapshot })
      ).length,
      outputBytes,
      serializationMs,
      reportedHeapDeltaBytes:
        beforeHeap === null ? null : performance.memory.usedJSHeapSize - beforeHeap,
    },
    prepared,
  };
}
