import * as core from '../src/index.js';
import { complexRecordFixture } from '../tests/helpers/complex-record-fixture.js';
import { benchmarkComplexRecords } from '../tests/helpers/complex-record-benchmark.js';

const metrics = [];
for (const size of [200, 2000]) {
  const fixture = complexRecordFixture(size);
  const before = process.memoryUsage();
  const result = await benchmarkComplexRecords(core, fixture);
  const after = process.memoryUsage();
  metrics.push({
    node: process.version,
    ...result.metrics,
    heapDeltaBytes: after.heapUsed - before.heapUsed,
    rssBytes: after.rss,
  });
}
console.log(
  JSON.stringify(
    {
      metrics,
      notes:
        'Broader-schema workload, reported separately from the original nine-element fixture and its 250ms/2s acceptance targets. Two warm-ups, five retained samples; no wall-clock assertions in ordinary tests. Heap deltas are not retained-memory measurements. Actual Hermes/device acceptance belongs to Plan 3.',
    },
    null,
    2
  )
);
