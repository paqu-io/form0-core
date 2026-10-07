import assert from 'node:assert/strict';

import { createFormEngine } from '../src/index.js';

function createCalculatedField(data_name, calculate) {
  return {
    type: 'CalculatedField',
    key: data_name,
    data_name,
    label: data_name,
    display: { style: 'text' },
    description: null,
    description_mode: null,
    required: false,
    visible: true,
    visible_conditions: null,
    read_only: true,
    calculate,
    supporting_image: false,
    supporting_image_path: null,
    supporting_image_display: null,
  };
}

function evaluate(calculate, engineOptions = { diagnostics: { console: false } }) {
  const schema = {
    form: {
      name: 'Missing result',
      description: null,
      elements: [createCalculatedField('result', calculate)],
    },
  };
  const engine = createFormEngine({ schema, ...engineOptions });
  engine.eval();
  return { value: engine.getState().values.result, diagnostics: engine.getDiagnostics() };
}

// A multiline calculation without SETRESULT() reports missing_result.
(() => {
  const { value, diagnostics } = evaluate('IF(\n  true,\n  "a",\n  "b"\n)');

  assert.equal(value, undefined);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'missing_result');
  assert.equal(diagnostics[0].severity, 'warning');
  assert.equal(diagnostics[0].phase, 'runtime');
  assert.equal(diagnostics[0].fieldName, 'result');
  assert.match(diagnostics[0].suggestion, /SETRESULT\(\)/);
  assert.match(diagnostics[0].suggestion, /explicit return/);
})();

// Single-line expressions, SETRESULT(), and an explicit return are not reported.
(() => {
  for (const calculate of [
    'IF(true, "a", "b")',
    'SETRESULT(IF(\n  true,\n  "a",\n  "b"\n))',
    'SETRESULT(undefined)\n',
    'const value = "a";\nreturn value;',
  ]) {
    const { diagnostics } = evaluate(calculate);
    assert.deepEqual(diagnostics, [], calculate);
  }
})();

// With default console reporting, the warning names the field.
(() => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    evaluate('IF(\n  true,\n  "a",\n  "b"\n)', {});
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /missing_result \(result\)/);
})();

console.log('Calculation missing-result tests passed.');
