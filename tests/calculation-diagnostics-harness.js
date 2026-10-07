import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFormEngine, createCalculationPreviewSession } from '../src/index.js';
import { captureConsole } from './helpers/calculation-fixtures.js';

const schema = JSON.parse(
  readFileSync(new URL('./fixtures/calculation-diagnostics.schema.json', import.meta.url))
);
const notifications = [];
const engine = createFormEngine({
  schema,
  diagnostics: { console: false },
  onDiagnostics: (snapshot) => notifications.push(snapshot),
});
assert.deepEqual(engine.getDiagnostics(), []);
const rows = [];
for (const [divisor, quotient, dependent, notice] of [
  [3, 4, 5, false],
  [0, null, 1, true],
  [4, 3, 4, false],
]) {
  engine.getState().values.divisor = divisor;
  const { calls } = captureConsole(() => engine.eval());
  assert.deepEqual(calls, [], 'calculation silence');
  const state = engine.getState();
  assert.equal(state.values.quotient, quotient);
  assert.equal(state.values.dependent, dependent);
  assert.equal(state.visible.failure_notice, notice);
  rows.push({
    divisor,
    quotient,
    dependent,
    independent: state.values.independent,
    notice,
    codes:
      engine
        .getDiagnostics()
        .map((item) => item.code)
        .join(', ') || '(none)',
  });
}
assert.deepEqual(
  notifications.map((items) => items.length),
  [0, 1, 0]
);
assert.deepEqual(engine.getDiagnostics(), []);
console.table(rows);
console.log('Callback snapshots: [], [runtime_exception], []. Recovery and console:false passed.');

const { calls } = captureConsole(() => {
  const reported = createFormEngine({
    schema,
    initialValues: { divisor: 0 },
    diagnostics: { console: true },
  });
  reported.eval();
  assert.equal(reported.getDiagnostics()[0].code, 'runtime_exception');
});
assert.ok(
  calls.some((call) => call.method === 'warn' && String(call.args[0]).includes('runtime_exception'))
);

const preview = createCalculationPreviewSession({
  schema,
  fieldDataName: 'quotient',
  expression: 'EVAL(42)',
});
assert.match(preview.run().runtimeError, /requires a string/);
assert.equal(preview.run({ expression: 'SETRESULT(3)' }).runtimeError, null);
preview.dispose();
console.log('Console:true and preview failure/recovery passed using workspace src/index.js.');
