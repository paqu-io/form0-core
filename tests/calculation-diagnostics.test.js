import assert from 'node:assert/strict';
import {
  createFormEngine,
  createCalculationPreviewSession,
  SAFE_SECURITY_CONFIG,
  WarningSystem,
} from '../src/index.js';
import { EVAL } from '../src/builtins/control/eval.js';
import {
  calculatedField,
  captureConsole,
  formSchema,
  numericField,
  repeatableSection,
  textField,
} from './helpers/calculation-fixtures.js';

function engineFor(expression, options = {}) {
  return createFormEngine({
    schema: formSchema([
      numericField('input', { default_value: 2 }),
      calculatedField('target', expression),
      calculatedField('dependent', '($target ?? 0) + 1'),
    ]),
    diagnostics: { console: false },
    ...options,
  });
}

function findDiagnostic(engine, code, fieldName = 'target') {
  const diagnostic = engine
    .getDiagnostics()
    .find((item) => item.code === code && item.fieldName === fieldName);
  assert.ok(diagnostic, `Missing ${code} for ${fieldName}`);
  assert.deepEqual(Object.keys(diagnostic).sort(), [
    'code',
    'context',
    'fieldName',
    'message',
    'phase',
    'severity',
    'suggestion',
  ]);
  assert.equal(typeof diagnostic.message, 'string');
  assert.ok(['warning', 'error'].includes(diagnostic.severity));
  assert.ok(['dependency', 'scope', 'validation', 'syntax', 'runtime'].includes(diagnostic.phase));
  assert.deepEqual(JSON.parse(JSON.stringify(diagnostic)), diagnostic);
  return diagnostic;
}

captureConsole(() => {
  const notifications = [];
  const engine = engineFor(
    'if ($input === 0) { throw new Error("boom"); }\nSETRESULT($input * 2);',
    {
      onDiagnostics: (snapshot) => notifications.push(snapshot),
    }
  );
  assert.deepEqual(engine.getDiagnostics(), []);
  assert.deepEqual(notifications, []);
  engine.eval();
  engine.eval();
  assert.deepEqual(notifications, [[], []]);
  engine.getState().values.input = 0;
  engine.eval();
  const diagnostic = findDiagnostic(engine, 'runtime_exception');
  assert.equal(diagnostic.severity, 'error');
  assert.equal(diagnostic.phase, 'runtime');
  assert.deepEqual(diagnostic.context, { source: 'expression', parentPath: [] });
  assert.equal(engine.getState().values.target, null);
  assert.equal(engine.getState().values.dependent, 1);
  assert.deepEqual(engine.getState().errors, {});
  const copy = engine.getDiagnostics();
  copy[0].message = 'changed';
  copy[0].context.parentPath.push('changed');
  copy.length = 0;
  notifications.at(-1)[0].context.parentPath.push('observer changed');
  assert.deepEqual(engine.getDiagnostics()[0].context.parentPath, []);
  assert.equal(engine.getDiagnostics()[0].message, 'boom');
  engine.eval();
  assert.equal(notifications.length, 4, 'identical failures still notify');
  assert.equal(engine.getDiagnostics().length, 1, 'history is replaced');
  engine.getState().values.input = 3;
  engine.eval();
  assert.equal(engine.getState().values.target, 6);
  assert.deepEqual(engine.getDiagnostics(), []);
  assert.deepEqual(notifications.at(-1), []);

  const empty = createFormEngine({
    schema: formSchema([numericField('input')]),
    onDiagnostics: (snapshot) => assert.deepEqual(snapshot, []),
  });
  empty.eval();
  assert.deepEqual(empty.getDiagnostics(), []);
});

captureConsole(() => {
  for (const expression of [
    'SETRESULT(null)',
    'SETRESULT(undefined)',
    'SETRESULT(0)',
    'SETRESULT(false)',
    'SETRESULT([1, 2])',
    'SETRESULT({ value: 3 })',
    'SETRESULT(0 / 0)',
    'SETRESULT(1 / 0)',
  ]) {
    const engine = engineFor(expression);
    engine.eval();
    assert.deepEqual(engine.getDiagnostics(), [], expression);
  }
  for (const [expression, code, phase, security] of [
    ['SETRESULT(', 'invalid_syntax', 'syntax', undefined],
    [
      'throw new SyntaxError("thrown at runtime");\nSETRESULT(1);',
      'runtime_exception',
      'runtime',
      undefined,
    ],
    ['window.location.href', 'expression_validation_failed', 'validation', SAFE_SECURITY_CONFIG],
    ['NOT_A_BUILTIN()', 'expression_validation_failed', 'validation', undefined],
    ['EVAL(42)', 'eval_invalid_argument', 'validation', undefined],
    ['EVAL("")', 'eval_invalid_argument', 'validation', undefined],
    ['EVAL("   ")', 'eval_invalid_argument', 'validation', undefined],
    ['EVAL("window.location.href")', 'expression_validation_failed', 'validation', undefined],
    ['EVAL("1 + (")', 'invalid_syntax', 'syntax', undefined],
    ['EVAL("null.value")', 'runtime_exception', 'runtime', undefined],
    ['EVAL("$absent")', 'eval_reference_unavailable', 'scope', undefined],
  ]) {
    const engine = engineFor(expression, security ? { security } : {});
    engine.eval();
    const diagnostic = findDiagnostic(engine, code);
    assert.equal(diagnostic.phase, phase, expression);
    assert.equal(diagnostic.severity, 'error', expression);
    assert.equal(diagnostic.context.source, expression.startsWith('EVAL') ? 'EVAL' : 'expression');
    assert.equal(engine.getState().values.target, null);
  }
  const successfulEval = engineFor('EVAL("$input")');
  successfulEval.eval();
  assert.equal(successfulEval.getState().values.target, 2);
  assert.deepEqual(successfulEval.getDiagnostics(), []);
});

captureConsole(() => {
  const warningSystem = new WarningSystem({ enableCollection: true, enableConsoleWarnings: false });
  const engine = createFormEngine({
    schema: formSchema([
      numericField('root', { default_value: 7 }),
      calculatedField('target', '$child ?? 10'),
      calculatedField('missing', '$absent + 1'),
      repeatableSection('rows', [
        numericField('child', { default_value: 3 }),
        calculatedField('row_total', '$child + $root'),
        repeatableSection('nested', [calculatedField('nested_total', '$row_total + $root')]),
      ]),
    ]),
    warningSystem,
    diagnostics: { console: false },
  });
  engine.eval();
  const restricted = findDiagnostic(engine, 'restricted_reference');
  assert.equal(restricted.context.referencedFieldName, 'child');
  assert.equal(restricted.severity, 'warning');
  findDiagnostic(engine, 'missing_reference', 'missing');
  findDiagnostic(engine, 'runtime_exception', 'missing');
  assert.equal(engine.getState().values.target, 10);
  assert.equal(engine.getState().values.nested_total, 17);
  const firstSnapshot = engine.getDiagnostics();
  const firstWarningCount = warningSystem.getCollectedWarnings().length;
  engine.eval();
  assert.deepEqual(engine.getDiagnostics(), firstSnapshot, 'collection ignores legacy throttling');
  assert.equal(warningSystem.getCollectedWarnings().length, firstWarningCount);
  assert.equal(warningSystem.getCollectedWarnings()[0].context.type, 'calculation');
  assert.equal('code' in warningSystem.getCollectedWarnings()[0], false, 'legacy shape unchanged');

  const nestedFailure = createFormEngine({
    schema: formSchema([
      repeatableSection('rows', [
        repeatableSection('nested', [calculatedField('target', 'EVAL(42)')]),
      ]),
    ]),
    diagnostics: { console: false },
  });
  nestedFailure.eval();
  assert.deepEqual(findDiagnostic(nestedFailure, 'eval_invalid_argument').context.parentPath, [
    'rows',
    'nested',
  ]);
});

captureConsole(() => {
  const cyclic = createFormEngine({
    schema: formSchema([calculatedField('a', '$b + 1'), calculatedField('b', '$a + 1')]),
    diagnostics: { console: false },
  });
  cyclic.eval();
  assert.equal(cyclic.getDiagnostics().length, 2);
  assert.deepEqual(findDiagnostic(cyclic, 'cyclic_dependencies', 'a').context.fieldNames, [
    'a',
    'b',
  ]);
  assert.equal(findDiagnostic(cyclic, 'cyclic_dependencies', 'b').severity, 'error');

  const intermediate = createFormEngine({
    schema: formSchema([
      calculatedField(
        'target',
        'const value = EVAL("$" + $selector);\nif (value === null) { throw new Error("not ready"); }\nSETRESULT(value);'
      ),
      calculatedField('source', '23'),
      textField('selector', { default_value: 'source' }),
    ]),
    diagnostics: { console: false },
  });
  intermediate.eval();
  assert.equal(intermediate.getState().values.target, 23);
  findDiagnostic(intermediate, 'runtime_exception');
  assert.equal(
    intermediate.getDiagnostics().filter((item) => item.code === 'dynamic_dependencies').length,
    1
  );
  intermediate.eval();
  assert.equal(
    intermediate.getDiagnostics().some((item) => item.code === 'runtime_exception'),
    false
  );

  const legacy = [];
  const nonConverging = createFormEngine({
    schema: formSchema([
      calculatedField('target', '(EVAL("$" + $selector) ?? 0) + 1'),
      textField('selector', { default_value: 'target' }),
    ]),
    runtimeDiagnostics: legacy,
    diagnostics: { console: false },
  });
  nonConverging.eval();
  assert.equal(nonConverging.getState().values.target, 2);
  assert.equal(findDiagnostic(nonConverging, 'non_converging_runtime').severity, 'warning');
  const oldLength = legacy.length;
  nonConverging.eval();
  assert.equal(legacy.length, oldLength, 'legacy dependency deduplication persists across eval');
  assert.equal(nonConverging.getState().values.target, 4);
});

const originalNodeEnv = process.env.NODE_ENV;
try {
  for (const environment of ['development', 'production']) {
    process.env.NODE_ENV = environment;
    for (const expression of ['EVAL(42)', 'EVAL("$input")', 'SETRESULT(', 'window.location.href']) {
      const { calls } = captureConsole(() => {
        const engine = engineFor(expression, { security: SAFE_SECURITY_CONFIG });
        engine.eval();
      });
      assert.deepEqual(calls, [], `${environment}: silent ${expression}`);
    }
    const { calls } = captureConsole(() => {
      const engine = createFormEngine({
        schema: formSchema([calculatedField('a', '$b'), calculatedField('b', '$a')]),
        warningSystem: new WarningSystem({ enableConsoleWarnings: false }),
        runtimeDiagnostics: [],
        diagnostics: { console: true },
      });
      engine.eval();
    });
    assert.equal(
      calls.filter((call) => call.method === 'warn').length,
      2,
      `${environment}: explicit console`
    );
  }
} finally {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
}

const observerFailure = captureConsole(() => {
  const engine = engineFor('4', {
    onDiagnostics: () => {
      throw new Error('observer failed');
    },
  });
  engine.eval();
  assert.equal(engine.getState().values.target, 4);
  assert.deepEqual(engine.getDiagnostics(), []);
});
assert.deepEqual(observerFailure.calls, [], 'silent mode includes observer failure reporting');

captureConsole(() => {
  const first = engineFor('EVAL(42)');
  const second = engineFor('EVAL("$input")');
  first.eval();
  second.eval();
  assert.deepEqual(second.getDiagnostics(), []);
  assert.equal(second.getState().values.target, 2);
  findDiagnostic(first, 'eval_invalid_argument');
  const directEval = captureConsole(() => EVAL(42));
  assert.equal(
    directEval.calls.length,
    1,
    'calculation silence must not leak into standalone EVAL'
  );

  const eventEngine = createFormEngine({
    schema: formSchema([calculatedField('target', '2')], {
      events: { code: 'ON("change", "target", function () { EVAL(42); });' },
    }),
    diagnostics: { console: false },
  });
  eventEngine.eval();
  const eventLog = captureConsole(() => eventEngine.trigger('change', 'target'));
  assert.ok(
    eventLog.calls.some((call) => String(call.args[0]).includes('EVAL() requires a string'))
  );
  assert.deepEqual(eventEngine.getDiagnostics(), [], 'events do not enter calculation snapshots');
});

captureConsole(() => {
  const schema = formSchema([calculatedField('target', '1')]);
  for (const [expression, security] of [
    ['window.location.href', SAFE_SECURITY_CONFIG],
    ['EVAL(42)', undefined],
    ['EVAL("null.value")', undefined],
  ]) {
    const session = createCalculationPreviewSession({
      schema,
      fieldDataName: 'target',
      expression,
      security,
    });
    const result = session.run();
    assert.equal(result.result, null);
    assert.equal(typeof result.runtimeError, 'string', expression);
    assert.ok(result.runtimeError.length > 0);
    assert.equal(session.run({ expression: 'SETRESULT(2)' }).runtimeError, null);
    session.dispose();
  }
});

captureConsole(() => {
  const nested = engineFor('EVAL(42)');
  const outer = engineFor('NESTED();\nEVAL(42);\nSETRESULT(7);', {
    security: { mode: 'trusted', validateBuiltins: false },
    helpers: { NESTED: () => nested.eval() },
  });
  outer.eval();
  findDiagnostic(nested, 'eval_invalid_argument');
  findDiagnostic(outer, 'eval_invalid_argument');
  assert.equal(outer.getState().values.target, 7);
  assert.equal(
    outer.getDiagnostics().filter((item) => item.code === 'eval_invalid_argument').length,
    1
  );
  assert.equal(captureConsole(() => EVAL(42)).calls.length, 1);

  const distinct = engineFor('EVAL(42);\nEVAL(42);\nEVAL("");\nSETRESULT(1);');
  distinct.eval();
  assert.equal(
    distinct.getDiagnostics().filter((item) => item.code === 'eval_invalid_argument').length,
    2
  );

  const nestedEval = engineFor('EVAL("EVAL(42)")');
  nestedEval.eval();
  assert.equal(findDiagnostic(nestedEval, 'eval_invalid_argument').context.source, 'EVAL');
  assert.equal(
    nestedEval.getDiagnostics().filter((item) => item.code === 'eval_invalid_argument').length,
    1
  );
  const successfulNestedEval = engineFor('EVAL("EVAL(\'$input\')")');
  successfulNestedEval.eval();
  assert.equal(successfulNestedEval.getState().values.target, 2);
  assert.equal(
    successfulNestedEval.getDiagnostics().some((item) => item.severity === 'error'),
    false
  );

  const syntaxAtRuntime = engineFor('EVAL("String(1)")', {
    helpers: {
      String: () => {
        throw new SyntaxError('EVAL runtime SyntaxError');
      },
    },
  });
  syntaxAtRuntime.eval();
  assert.equal(findDiagnostic(syntaxAtRuntime, 'runtime_exception').phase, 'runtime');
  assert.equal(
    syntaxAtRuntime.getDiagnostics().some((item) => item.code === 'invalid_syntax'),
    false
  );

  const privacy = engineFor('EVAL("$input + 12345")');
  privacy.eval();
  assert.equal(JSON.stringify(privacy.getDiagnostics()).includes('$input + 12345'), false);
  assert.equal(
    'referencedFieldName' in findDiagnostic(privacy, 'eval_reference_unavailable').context,
    false
  );

  const legacy = [];
  const compatibility = engineFor('throw new Error("legacy");\nSETRESULT(1);', {
    diagnostics: undefined,
    runtimeDiagnostics: legacy,
  });
  compatibility.eval();
  compatibility.eval();
  assert.equal(legacy.length, 2, 'legacy runtime errors keep append behavior');
  assert.equal(compatibility.getDiagnostics().length, 1);
  assert.deepEqual(Object.keys(legacy[0]).sort(), [
    'dedupeKey',
    'fieldName',
    'message',
    'severity',
  ]);

  const schema = formSchema([
    numericField('input', { default_value: 0, min: 0, required: true }),
    calculatedField('target', 'EVAL(42)'),
  ]);
  const observed = [];
  const engine = createFormEngine({
    schema,
    initialValues: { input: -1 },
    diagnostics: { console: false },
    onDiagnostics: (items) => observed.push(items),
  });
  engine.eval();
  assert.ok(engine.getState().errors.input, 'intrinsic validation still runs');
  assert.equal(engine.getState().required.input, true);
  assert.equal(engine.getState().errors.target, undefined);
  const previous = engine.getDiagnostics();
  Object.defineProperty(engine.getState().values, 'input', {
    enumerable: true,
    configurable: true,
    get() {
      throw new Error('host getter failed');
    },
  });
  assert.throws(() => engine.eval(), /host getter failed/);
  assert.deepEqual(
    engine.getDiagnostics(),
    previous,
    'incomplete evaluation does not replace latest snapshot'
  );
  assert.equal(observed.length, 1, 'incomplete evaluation does not notify');
  delete engine.getState().values.input;
  engine.getState().values.input = 1;
  engine.eval();
  assert.equal(observed.length, 2);
  assert.deepEqual(engine.getState().errors, {});
});

const observerLogged = captureConsole(() => {
  const engine = engineFor('4', {
    diagnostics: { console: true },
    onDiagnostics: () => {
      throw new Error('private observer data');
    },
  });
  engine.eval();
  assert.equal(engine.getState().values.target, 4);
});
assert.equal(observerLogged.calls.length, 1);
assert.equal(JSON.stringify(observerLogged.calls).includes('private observer data'), false);

const savedProcess = globalThis.process;
const savedWindow = globalThis.window;
try {
  globalThis.process = undefined;
  for (const [hostname, port, isDevelopment] of [
    ['localhost', '', true],
    ['127.0.0.1', '', true],
    ['example.test', '3030', true],
    ['example.test', '', false],
  ]) {
    globalThis.window = { location: { hostname, port } };
    const warnings = new WarningSystem();
    assert.equal(warnings.isDevelopment, isDevelopment);
    for (const enabled of [false, true]) {
      const { calls } = captureConsole(() => {
        const engine = engineFor('EVAL(42)', {
          diagnostics: { console: enabled },
          warningSystem: warnings,
        });
        engine.eval();
        findDiagnostic(engine, 'eval_invalid_argument');
      });
      assert.equal(calls.length > 0, enabled, `${hostname}:${port} override ${enabled}`);
    }
  }
} finally {
  globalThis.process = savedProcess;
  if (savedWindow === undefined) delete globalThis.window;
  else globalThis.window = savedWindow;
}

const originalWarn = console.warn;
captureConsole(() => {
  for (const message of ['1n', '{ privateValue: "do not copy" }']) {
    const engine = engineFor(
      `const error = new Error();\nerror.message = ${message};\nthrow error;`,
      {
        initialValues: { target: 8 },
      }
    );
    engine.eval();
    assert.equal(
      engine.getState().values.target,
      null,
      'diagnostic serialization must preserve failed result'
    );
    assert.equal(
      findDiagnostic(engine, 'runtime_exception').message,
      'Unknown calculation runtime error.'
    );
    assert.equal(JSON.stringify(engine.getDiagnostics()).includes('do not copy'), false);
  }
});

const originalFunction = globalThis.Function;
captureConsole(() => {
  try {
    const engine = engineFor('1');
    globalThis.Function = function () {
      throw new EvalError('CSP compilation blocked');
    };
    engine.eval();
    assert.equal(findDiagnostic(engine, 'compilation_error').phase, 'syntax');
    assert.equal(engine.getState().values.target, null);
    globalThis.Function = originalFunction;

    const nested = engineFor('EVAL("1 + 2")');
    let compilations = 0;
    globalThis.Function = function (...args) {
      compilations += 1;
      if (compilations === 2) throw new EvalError('EVAL compilation blocked');
      return new originalFunction(...args);
    };
    nested.eval();
    assert.equal(findDiagnostic(nested, 'compilation_error').context.source, 'EVAL');
    assert.equal(
      nested.getState().values.target,
      3,
      'later stabilization succeeds but retains compilation incident'
    );
  } finally {
    globalThis.Function = originalFunction;
  }
});

try {
  for (const enabled of [false, true]) {
    const calls = [];
    console.warn = (...args) => calls.push(args);
    const engine = engineFor('4', {
      diagnostics: { console: enabled },
      onDiagnostics: async () => {
        throw new Error('async observer data');
      },
    });
    engine.eval();
    await Promise.resolve();
    assert.equal(engine.getState().values.target, 4);
    assert.equal(calls.length, enabled ? 1 : 0);
    assert.equal(JSON.stringify(calls).includes('async observer data'), false);
  }
} finally {
  console.warn = originalWarn;
}

console.log('Calculation diagnostic contract tests passed.');
