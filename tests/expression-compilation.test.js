import assert from 'node:assert/strict';
import { runExpression } from '../src/engine/evaluator.js';
import { createRecordEvaluator, SAFE_SECURITY_CONFIG } from '../src/index.js';
import {
  complexRecordFixture,
  checkComplexSnapshot,
  expectedComplexSnapshot,
} from './helpers/complex-record-fixture.js';

// Regression: the populated record path reused functions but still sorted/serialized
// hundreds of argument names for every calculation in every row.
const originalStringify = JSON.stringify;
const OriginalFunction = globalThis.Function;
let signatures = 0;
let compilations = 0;
JSON.stringify = function (value, ...args) {
  if (Array.isArray(value) && ['body', 'expression'].includes(value[0]) && Array.isArray(value[1]))
    signatures++;
  return originalStringify.call(this, value, ...args);
};
globalThis.Function = new Proxy(OriginalFunction, {
  construct(target, args) {
    compilations++;
    return Reflect.construct(target, args);
  },
});
try {
  const fixture = complexRecordFixture(200);
  const evaluator = createRecordEvaluator({
    schema: fixture.schema,
    diagnostics: { console: false },
  });
  let firstSignatures;
  for (let pass = 0; pass < 2; pass++) {
    const result = await evaluator.prepareSubmission(fixture.snapshot);
    assert.equal(result.status, 'ready');
    assert.equal(
      checkComplexSnapshot(result.snapshot, expectedComplexSnapshot(fixture.snapshot, 'refresh')),
      200
    );
    if (pass === 0) firstSignatures = signatures;
    else
      assert.equal(signatures, firstSignatures, 'Warm rows must reuse prepared argument layouts');
  }
  assert.ok(
    compilations <= fixture.dimensions.calculationDefinitions,
    `Unexpected recompilations: ${compilations}`
  );
  assert.ok(
    signatures <= fixture.dimensions.calculationDefinitions * 2,
    `Argument signatures rebuilt for rows: ${signatures}`
  );
} finally {
  JSON.stringify = originalStringify;
  globalThis.Function = OriginalFunction;
}

for (const security of [{ mode: 'trusted' }, SAFE_SECURITY_CONFIG]) {
  const compileCache = new Map();
  const evaluate = (expression, context, config = security) =>
    runExpression(expression, context, config, false, null, {
      compileCache,
      suppressConsoleWarning: true,
    });
  assert.equal(evaluate('$a + $b', { $a: 1, $b: 2 }), 3);
  assert.equal(evaluate('$a + $b', { $a: 10, $b: 20 }), 30);
  assert.equal(evaluate('$a + $b', { $b: 40, $a: 2 }), 42);
  assert.equal(evaluate('$a + $b', { $a: 3, $b: 4, $unused: 0 }), 7);
  assert.equal(evaluate('$a + $b', { $a: 5, $b: 6 }), 11);
  assert.equal(
    evaluate(
      '$a + $b',
      { $a: 1, $b: 2 },
      { ...security, mode: 'custom', blockedPatterns: [/\$a/] }
    ),
    null
  );
  compileCache.clear();
  assert.equal(evaluate('$a + $b', { $a: 7, $b: 8 }), 15);
}
assert.deepEqual(
  runExpression('Array.from(arguments)', { $b: 2, $a: 1 }, { mode: 'trusted' }, false, null, {
    compileCache: new Map(),
  }),
  [1, 2]
);
console.log(
  'Expression compilation preserves current bindings, key changes, permissions and bounded schema preparation.'
);
