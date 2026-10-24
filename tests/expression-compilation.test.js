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

// Simple record calculations bind only their proven scalar inputs and canonical calls.
// This is a deterministic work-count regression, not a wall-clock unit-test threshold.
{
  const { formSchema, numericField, calculatedField } = await import(
    './helpers/calculation-fixtures.js'
  );
  const parameters = [];
  globalThis.Function = new Proxy(OriginalFunction, {
    construct(target, args) {
      if (args.at(-1).includes('$x * $factor')) parameters.push(args.slice(0, -1));
      return Reflect.construct(target, args);
    },
  });
  try {
    const schema = formSchema([
      numericField('x'),
      numericField('factor'),
      numericField('y'),
      ...Array.from({ length: 80 }, (_, index) => numericField(`unused_${index}`)),
      calculatedField('result', 'SETRESULT(IF($x > 0, $x * $factor + $y, $y))'),
    ]);
    for (const security of [{ mode: 'trusted' }, SAFE_SECURITY_CONFIG]) {
      const evaluator = createRecordEvaluator({
        schema,
        security,
        diagnostics: { console: false },
      });
      for (const x of [0, 10, 30]) {
        const result = await evaluator.evaluate({ values: { x, factor: 1.2, y: 1 } });
        assert.equal(result.status, 'evaluated');
        assert.equal(result.snapshot.values.result, x * 1.2 + 1);
        assert.deepEqual(result.diagnostics, []);
      }
    }
  } finally {
    globalThis.Function = OriginalFunction;
  }
  assert.equal(parameters.length, 2, 'One compilation per security-configured evaluator');
  assert.ok(
    parameters.every(
      (keys) => keys.includes('$x') && keys.includes('$factor') && keys.includes('$y')
    )
  );
  assert.ok(
    parameters.every((keys) => !keys.some((key) => key.startsWith('$unused_'))),
    'Unused fields must not be rebound for every scalar calculation'
  );
}

// The scalar specialization must fall back whenever JavaScript can observe extra bindings.
{
  const { formSchema, numericField, calculatedField } = await import(
    './helpers/calculation-fixtures.js'
  );
  const { createFormEngine } = await import('../src/index.js');
  const { EVAL } = await import('../src/builtins/control/eval.js');
  const { prepareScalarBindings } = await import('../src/engine/calculation-bindings.js');
  for (const code of [
    "EVAL('$x')",
    "EVAL('$' + 'x')",
    'Array.from(arguments).length',
    'helper()',
    'IF',
    'ROUND($x, 0)',
    'Math.round($x)',
    '[$x]',
    '({ x: $x })',
    '(function() { return $x; })()',
    'eval("$x")',
    'this',
    '$x.value',
    'let y = $x;\nSETRESULT(y);',
    'SETRESULT(',
  ])
    assert.equal(prepareScalarBindings(code), null, code);
  for (const security of [{ mode: 'trusted' }, SAFE_SECURITY_CONFIG]) {
    const cases = [
      { code: 'SETRESULT($x + 1)', x: 0 },
      { code: 'SETRESULT($x)', x: { selected: [0, false] } },
      { code: "SETRESULT(EVAL('$x'))", x: 12 },
      { code: "SETRESULT(EVAL('$' + 'x'))", x: 13 },
      { code: 'SETRESULT(helper())', x: 14, helpers: { helper: () => EVAL('ROUND(12.4, 0)') } },
      { code: 'SETRESULT(IF($x, 1, 0))', x: 15, helpers: { IF: () => EVAL('ROUND(22.4, 0)') } },
      { code: 'SETRESULT(Array.from(arguments).length)', x: 16 },
      { code: 'SETRESULT(NaN + 1)', x: 17, helpers: { NaN: { valueOf: () => 4 } } },
      { code: 'let alias = EVAL;\nSETRESULT(alias("$x"));', x: 18 },
    ];
    for (const { code, x, helpers = {} } of cases) {
      const schema = formSchema([
        numericField('x'),
        ...Array.from({ length: 20 }, (_, i) => numericField(`unused_${i}`)),
        calculatedField('result', code),
      ]);
      const input = { values: { x } };
      const original = structuredClone(input);
      const instance = createRecordEvaluator({
        schema,
        security,
        helpers,
        diagnostics: { console: false },
      });
      const engine = createFormEngine({
        schema,
        security,
        helpers,
        initialValues: input.values,
        diagnostics: { console: false },
      });
      engine.eval();
      const result = await instance.evaluate(input);
      assert.equal(result.status, 'evaluated', code);
      assert.deepEqual(result.snapshot.values.result, engine.getState().values.result, code);
      assert.deepEqual(
        result.diagnostics.map((item) => item.code),
        engine.getDiagnostics().map((item) => item.code),
        code
      );
      assert.deepEqual(input, original);
    }
    const schema = formSchema([numericField('x'), calculatedField('result', 'SETRESULT($x)')]);
    const instance = createRecordEvaluator({ schema, security, diagnostics: { console: false } });
    for (const x of [1, { changing: true }, 3, null, false, 0]) {
      const result = await instance.evaluate({ values: { x } });
      assert.deepEqual(
        result.snapshot.values.result,
        x,
        'Switching binding layouts cannot reuse prior values'
      );
    }
  }
  const schema = formSchema([numericField('x'), calculatedField('result', 'SETRESULT($x)')]);
  const instance = createRecordEvaluator({
    schema,
    security: { mode: 'custom', blockedPatterns: [/SETRESULT/g] },
    diagnostics: { console: false },
  });
  const results = [];
  for (let index = 0; index < 3; index++)
    results.push(await instance.evaluate({ values: { x: 7 } }));
  assert.deepEqual(
    results.map((result) => result.snapshot.values.result),
    [null, 7, null],
    'Security validation must still execute on every invocation'
  );
}

// An unresolved identifier can use an existing host global under legacy execution.
// Never narrow its ambient context based only on the missing schema reference.
{
  const { formSchema, numericField, calculatedField } = await import(
    './helpers/calculation-fixtures.js'
  );
  const { EVAL } = await import('../src/builtins/control/eval.js');
  const name = '$throughput_external';
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: { valueOf: () => EVAL('ROUND(12.4, 0)') },
  });
  try {
    for (const security of [{ mode: 'trusted' }, SAFE_SECURITY_CONFIG]) {
      const schema = formSchema([
        numericField('x'),
        calculatedField('result', 'SETRESULT($throughput_external + 1)'),
      ]);
      const result = await createRecordEvaluator({
        schema,
        security,
        diagnostics: { console: false },
      }).evaluate({ values: { x: 1 } });
      assert.equal(result.snapshot.values.result, 13);
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete globalThis[name];
  }
}
