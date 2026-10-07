import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createFormEngine,
  createCalculationPreviewSession,
  SAFE_SECURITY_CONFIG,
  WarningSystem,
} from '../src/index.js';
import {
  calculatedField,
  captureConsole,
  formSchema,
  numericField,
  repeatableSection,
  textField,
} from './helpers/calculation-fixtures.js';

// These assertions characterize c9f6f75 before runtime edits. Keep them unchanged
// after adding diagnostics: they protect results, evaluation counts and legacy reporting.
captureConsole(() => {
  const schema = JSON.parse(
    readFileSync(new URL('./fixtures/calculation-diagnostics.schema.json', import.meta.url))
  );
  const runtimeDiagnostics = [];
  const engine = createFormEngine({ schema, runtimeDiagnostics });
  const expected = [
    [3, 4, 5, false],
    [0, null, 1, true],
    [4, 3, 4, false],
  ];
  for (const [divisor, quotient, dependent, visible] of expected) {
    engine.getState().values.divisor = divisor;
    engine.eval();
    const state = engine.getState();
    assert.equal(state.values.quotient, quotient);
    assert.equal(state.values.dependent, dependent);
    assert.equal(state.values.independent, 24);
    assert.equal(state.visible.failure_notice, visible);
    assert.deepEqual(state.errors, {});
    assert.equal(state.required.note, false);
    assert.equal(state.read_only.quotient, true);
    assert.equal(state.values.note, 'initial', 'eval must not dispatch change');
  }
  assert.equal(runtimeDiagnostics.length, 1);
  assert.deepEqual(runtimeDiagnostics[0], {
    fieldName: 'quotient',
    message: 'Division by zero',
    severity: 'error',
    dedupeKey: null,
  });
  const operations = engine.trigger('change', 'divisor');
  assert.deepEqual(operations, [
    {
      type: 'FIELD_OPERATION',
      operation: 'SETVALUE',
      params: { fieldDataName: 'note', valueToSet: 'divisor changed' },
    },
  ]);
  assert.equal(engine.getState().values.note, 'initial', 'host still applies returned operations');
});

captureConsole(() => {
  for (const [expression, expected] of [
    ['SETRESULT(0)', 0],
    ['SETRESULT(false)', false],
    ['SETRESULT(null)', null],
    ['SETRESULT(undefined)', undefined],
    ['SETRESULT([1, 2])', [1, 2]],
    ['SETRESULT({ value: 3 })', { value: 3 }],
    ['SETRESULT(0 / 0)', NaN],
    ['SETRESULT(1 / 0)', Infinity],
    ['SETRESULT(12);\nthrow new Error("boom");', null],
    ['SETRESULT(', null],
  ]) {
    const engine = createFormEngine({
      schema: formSchema([
        calculatedField('target', expression),
        calculatedField('dependent', 'SETRESULT(($target ?? 0) + 1)'),
      ]),
      runtimeDiagnostics: [],
    });
    engine.eval();
    assert.deepEqual(engine.getState().values.target, expected, expression);
  }
  const healthy = createFormEngine({ schema: formSchema([calculatedField('target', '6')]) });
  healthy.eval();
  assert.equal(healthy.getState().values.target, 6, 'failed SETRESULT must not leak');
});

captureConsole(() => {
  const calls = [];
  const engine = createFormEngine({
    schema: formSchema([
      calculatedField('total', 'TRACE("total", $source + 1)'),
      calculatedField('source', 'TRACE("source", $input * 2)'),
      numericField('input', { default_value: 3 }),
    ]),
    security: { mode: 'trusted', validateBuiltins: false },
    helpers: {
      TRACE: (name, value) => {
        calls.push(name);
        return value;
      },
    },
  });
  engine.eval();
  assert.deepEqual(calls, ['source', 'total']);
  assert.equal(engine.getState().values.total, 7);
  engine.getState().values.input = 4;
  engine.eval();
  assert.deepEqual(calls, ['source', 'total', 'source', 'total']);
  assert.equal(engine.getState().values.total, 9);

  const cyclic = createFormEngine({
    schema: formSchema([
      calculatedField('a', '$b + 1'),
      calculatedField('b', '$a + 1'),
      calculatedField('dependent', '($a ?? 0) + 5'),
    ]),
  });
  cyclic.eval();
  assert.equal(cyclic.getState().values.a, null);
  assert.equal(cyclic.getState().values.b, null);
  assert.equal(cyclic.getState().values.dependent, 5);

  const dynamic = createFormEngine({
    schema: formSchema([
      calculatedField('target', 'EVAL("$" + $selector)'),
      calculatedField('source', '23'),
      textField('selector', { default_value: 'source' }),
    ]),
  });
  dynamic.eval();
  assert.equal(dynamic.getState().values.target, 23);
});

captureConsole(() => {
  const calls = [];
  const helpers = {
    TRACE: (name, value) => {
      calls.push(name);
      return value;
    },
  };
  const security = { mode: 'trusted', validateBuiltins: false };
  const dynamic = createFormEngine({
    schema: formSchema([
      calculatedField('target', 'TRACE("target", EVAL("$" + $selector))'),
      calculatedField('source', 'TRACE("source", 23)'),
      textField('selector', { default_value: 'source' }),
    ]),
    helpers,
    security,
  });
  dynamic.eval();
  assert.deepEqual(calls, ['target', 'source', 'target', 'source']);
  assert.equal(dynamic.getState().values.target, 23);
  calls.length = 0;
  dynamic.eval();
  assert.deepEqual(calls, ['target', 'source'], 'stable values stop after one pass');

  calls.length = 0;
  const nonConverging = createFormEngine({
    schema: formSchema([
      calculatedField('target', 'TRACE("target", (EVAL("$" + $selector) ?? 0) + 1)'),
      textField('selector', { default_value: 'target' }),
    ]),
    helpers,
    security,
  });
  nonConverging.eval();
  assert.deepEqual(calls, ['target', 'target']);
  assert.equal(nonConverging.getState().values.target, 2);
  nonConverging.eval();
  assert.deepEqual(calls, ['target', 'target', 'target', 'target']);
  assert.equal(nonConverging.getState().values.target, 4);

  for (const [expression, expected] of [
    ['EVAL("$input")', 2],
    ['EVAL("EVAL(\'$input\')")', 2],
    ['EVAL(42)', null],
    ['EVAL("")', null],
    ['EVAL("   ")', null],
    ['EVAL("$absent")', null],
    ['EVAL("window.location.href")', null],
    ['EVAL("1 + (")', null],
    ['EVAL("null.value")', null],
  ]) {
    const engine = createFormEngine({
      schema: formSchema([
        numericField('input', { default_value: 2 }),
        calculatedField('target', expression),
        calculatedField('dependent', '($target ?? 0) + 1'),
      ]),
    });
    engine.eval();
    assert.equal(engine.getState().values.target, expected, expression);
    assert.equal(engine.getState().values.dependent, (expected ?? 0) + 1);
    assert.deepEqual(engine.getState().errors, {});
  }
});

captureConsole(() => {
  const warningSystem = new WarningSystem({ enableCollection: true, throttleMs: 0 });
  const engine = createFormEngine({
    schema: formSchema([
      numericField('root', { default_value: 7 }),
      calculatedField('restricted', '$child ?? 10'),
      calculatedField('missing', '$absent + 1'),
      repeatableSection('rows', [
        numericField('child', { default_value: 3 }),
        calculatedField('row_total', '$child + $root'),
        repeatableSection('nested', [calculatedField('nested_total', '$row_total + $root')]),
      ]),
    ]),
    warningSystem,
  });
  engine.eval();
  assert.equal(engine.getState().values.restricted, 10);
  assert.equal(engine.getState().values.missing, null);
  assert.equal(engine.getState().values.row_total, 10);
  assert.equal(engine.getState().values.nested_total, 17);
  assert.equal(warningSystem.getCollectedWarnings().length, 2);
});

const originalNodeEnv = process.env.NODE_ENV;
try {
  for (const mode of ['development', 'production']) {
    process.env.NODE_ENV = mode;
    for (const [name, fields, security, expectedWarns] of [
      [
        'runtime',
        [calculatedField('target', 'throw new Error("boom");\nSETRESULT(1);')],
        undefined,
        1,
      ],
      ['security', [calculatedField('target', 'window.location.href')], SAFE_SECURITY_CONFIG, 1],
      [
        'cycle',
        [calculatedField('a', '$b'), calculatedField('b', '$a')],
        undefined,
        mode === 'development' ? 2 : 0,
      ],
      [
        'eval invalid',
        [calculatedField('target', 'EVAL(42)')],
        undefined,
        mode === 'development' ? 3 : 1,
      ],
    ]) {
      const { calls } = captureConsole(() => {
        const engine = createFormEngine({ schema: formSchema(fields), security });
        engine.eval();
      });
      assert.equal(
        calls.filter((call) => call.method === 'warn').length,
        expectedWarns,
        `${mode}: ${name}`
      );
    }
    const { calls } = captureConsole(() => {
      const engine = createFormEngine({
        schema: formSchema([calculatedField('target', 'throw new Error("boom");\nSETRESULT(1);')]),
        runtimeDiagnostics: [],
      });
      engine.eval();
    });
    assert.deepEqual(calls, [], 'legacy runtimeDiagnostics suppresses direct runtime logging');
  }
} finally {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
}

captureConsole(() => {
  const schema = formSchema([
    numericField('input', { default_value: 2 }),
    calculatedField('target', 'SETRESULT($input * 2)'),
  ]);
  const preview = createCalculationPreviewSession({
    schema,
    fieldDataName: 'target',
    expression: 'SETRESULT($input * 2)',
  });
  assert.deepEqual(preview.run({ values: { input: 3 } }), {
    result: 6,
    runtimeError: null,
    warnings: [],
  });
  assert.equal(
    preview.run({ expression: 'throw new Error("preview boom");\nSETRESULT(1);' }).runtimeError,
    'preview boom'
  );
  assert.deepEqual(preview.run({ expression: 'SETRESULT($input * 2)', values: { input: 4 } }), {
    result: 8,
    runtimeError: null,
    warnings: [],
  });
  preview.dispose();
  assert.match(preview.run().runtimeError, /disposed/);
});

console.log('Calculation diagnostics characterization tests passed (baseline c9f6f75).');
