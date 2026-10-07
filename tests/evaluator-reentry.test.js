import assert from 'node:assert/strict';

import { createFormEngine } from '../src/index.js';
import {
  calculatedField,
  captureConsole,
  formSchema,
  numericField,
  textField,
} from './helpers/calculation-fixtures.js';

const trustedSecurity = { mode: 'trusted', validateBuiltins: false };
const silentDiagnostics = { console: false };

const createInnerEngine = (calculate = 'SETRESULT(EVAL("$inner_input"))', options = {}) =>
  createFormEngine({
    schema: formSchema([
      numericField('inner_input', { default_value: 3 }),
      calculatedField('inner_target', calculate),
    ]),
    security: trustedSecurity,
    diagnostics: silentDiagnostics,
    ...options,
  });

// Cross-engine evaluation restores the outer value and schema contexts.
captureConsole(() => {
  const inner = createInnerEngine();

  for (const [expression, expected] of [
    ['NESTED();\nSETRESULT(EVAL("$input"));', 7],
    ['NESTED();\nSETRESULT(DATANAMES().join(","));', 'input,target'],
  ]) {
    const outer = createFormEngine({
      schema: formSchema([
        numericField('input', { default_value: 7 }),
        calculatedField('target', expression),
      ]),
      helpers: { NESTED: () => inner.eval() },
      security: trustedSecurity,
      diagnostics: silentDiagnostics,
    });

    outer.eval();
    assert.equal(outer.getState().values.target, expected);
    assert.deepEqual(outer.getDiagnostics(), []);
  }
});

// SETRESULT belongs to the active expression even when a nested expression also uses it.
captureConsole(() => {
  const inner = createInnerEngine('SETRESULT(99)');
  const outer = createFormEngine({
    schema: formSchema([calculatedField('target', 'SETRESULT(41);\nNESTED();')]),
    helpers: { NESTED: () => inner.eval() },
    security: trustedSecurity,
    diagnostics: silentDiagnostics,
  });

  outer.eval();
  assert.equal(inner.getState().values.inner_target, 99);
  assert.equal(outer.getState().values.target, 41);
  assert.deepEqual(outer.getDiagnostics(), []);
});

// Multiple levels and a failed inner calculation do not disturb the enclosing contexts.
captureConsole(() => {
  const failing = createInnerEngine('throw new Error("inner failure");\nSETRESULT(99);');
  const middle = createFormEngine({
    schema: formSchema([
      numericField('middle_input', { default_value: 5 }),
      calculatedField(
        'middle_target',
        'DEEPEST();\nSETRESULT(EVAL("$middle_input") + DATANAMES().length);'
      ),
    ]),
    helpers: { DEEPEST: () => failing.eval() },
    security: trustedSecurity,
    diagnostics: silentDiagnostics,
  });
  const outer = createFormEngine({
    schema: formSchema([
      numericField('outer_input', { default_value: 7 }),
      calculatedField(
        'outer_target',
        'MIDDLE();\nSETRESULT(EVAL("$outer_input") + DATANAMES().length);'
      ),
    ]),
    helpers: { MIDDLE: () => middle.eval() },
    security: trustedSecurity,
    diagnostics: silentDiagnostics,
  });

  outer.eval();
  assert.equal(failing.getState().values.inner_target, null);
  assert.equal(middle.getState().values.middle_target, 7);
  assert.equal(outer.getState().values.outer_target, 9);
  assert.equal(failing.getDiagnostics()[0]?.code, 'runtime_exception');
  assert.deepEqual(middle.getDiagnostics(), []);
  assert.deepEqual(outer.getDiagnostics(), []);
});

// Event handlers receive their original value/schema contexts after a nested calculation.
captureConsole(() => {
  const inner = createInnerEngine();
  const outer = createFormEngine({
    schema: formSchema([numericField('input', { default_value: 7 }), textField('note')], {
      events: {
        code: `
          ON('change', 'input', function () {
            NESTED();
            SETVALUE('note', EVAL('$input') + ':' + DATANAMES().join(','));
          });
        `,
      },
    }),
    helpers: { NESTED: () => inner.eval() },
    security: trustedSecurity,
    diagnostics: silentDiagnostics,
  });

  outer.eval();
  assert.deepEqual(outer.trigger('change', 'input'), [
    {
      type: 'FIELD_OPERATION',
      operation: 'SETVALUE',
      params: { fieldDataName: 'note', valueToSet: '7:input,note' },
    },
  ]);
});

// Calculation diagnostics stay with the engine/frame that emitted them.
captureConsole(() => {
  const innerSnapshots = [];
  const outerSnapshots = [];
  const inner = createInnerEngine('EVAL("$absent")', {
    onDiagnostics: (snapshot) => innerSnapshots.push(snapshot),
  });
  const outer = createFormEngine({
    schema: formSchema([
      numericField('input', { default_value: 7 }),
      calculatedField('target', 'NESTED();\nSETRESULT(EVAL(42));'),
    ]),
    helpers: { NESTED: () => inner.eval() },
    security: trustedSecurity,
    diagnostics: silentDiagnostics,
    onDiagnostics: (snapshot) => outerSnapshots.push(snapshot),
  });

  outer.eval();
  const innerDiagnostic = innerSnapshots
    .at(-1)
    .find(({ code }) => code === 'eval_reference_unavailable');
  const outerDiagnostic = outerSnapshots
    .at(-1)
    .find(({ code }) => code === 'eval_invalid_argument');
  assert.equal(innerDiagnostic?.fieldName, 'inner_target');
  assert.equal(outerDiagnostic?.fieldName, 'target');
});

// Same-engine synchronous reentry remains supported when the caller supplies a finite guard.
captureConsole(() => {
  let engine;
  let depth = 0;
  let reentries = 0;
  const reenter = () => {
    if (depth > 0) return;
    depth += 1;
    reentries += 1;
    try {
      engine.eval();
    } finally {
      depth -= 1;
    }
  };

  engine = createFormEngine({
    schema: formSchema([
      numericField('input', { default_value: 7 }),
      calculatedField('target', 'REENTER();\nSETRESULT(EVAL("$input"));'),
    ]),
    helpers: { REENTER: reenter },
    security: trustedSecurity,
    diagnostics: silentDiagnostics,
  });

  engine.eval();
  assert.equal(engine.getState().values.target, 7);
  assert.ok(reentries > 0 && reentries < 10, 'guarded reentry must terminate predictably');
  assert.deepEqual(engine.getDiagnostics(), []);
});

console.log('Evaluator reentry tests passed.');
