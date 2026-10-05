import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';

import {
  BUILTIN_DEFINITIONS,
  calculationBuiltins,
  eventBuiltins,
} from '../src/builtins/registry.js';
import { validateExpression } from '../src/security/validation.js';

// Metro reports cycles even when Node's ESM loader can resolve the same graph.
// Check static relative imports and re-exports without requiring a Metro install.
const completed = new Set();
function checkImports(moduleUrl, ancestors = []) {
  assert.ok(
    !ancestors.includes(moduleUrl.href),
    `Circular core import: ${[...ancestors, moduleUrl.href].join(' -> ')}`
  );
  if (completed.has(moduleUrl.href)) return;
  const tree = parse(readFileSync(moduleUrl, 'utf8'), {
    ecmaVersion: 'latest',
    sourceType: 'module',
  });
  for (const node of tree.body) {
    if (
      ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) &&
      node.source?.value.startsWith('.')
    ) {
      checkImports(new URL(node.source.value, moduleUrl), [...ancestors, moduleUrl.href]);
    }
  }
  completed.add(moduleUrl.href);
}
checkImports(new URL('../src/index.js', import.meta.url));

// Runtime membership and security acceptance must agree for every builtin/context.
assert.equal(new Set(BUILTIN_DEFINITIONS.map(({ name }) => name)).size, BUILTIN_DEFINITIONS.length);
for (const [context, runtime, includeEvents] of [
  ['calculation', calculationBuiltins, false],
  ['event', eventBuiltins, true],
]) {
  const expectedNames = BUILTIN_DEFINITIONS.filter(({ contexts }) =>
    contexts.includes(context)
  ).map(({ name }) => name);
  assert.deepEqual(Object.keys(runtime), expectedNames);
  for (const mode of ['trusted', 'safe', 'custom']) {
    for (const { name, contexts } of BUILTIN_DEFINITIONS) {
      const result = validateExpression(
        `${name}()`,
        { mode, validateBuiltins: true },
        includeEvents
      );
      assert.equal(result.valid, contexts.includes(context), `${mode}/${context}: ${name}`);
      if (!result.valid) assert.ok(result.reason.startsWith(`Unknown builtin function: ${name}.`));
    }
    assert.deepEqual(
      validateExpression('COUNTT()', { mode, validateBuiltins: true }, includeEvents),
      { valid: false, reason: 'Unknown builtin function: COUNTT. Did you mean COUNT?' }
    );
    assert.deepEqual(
      validateExpression('UNKNOWN()', { mode, validateBuiltins: false }, includeEvents),
      { valid: true }
    );
  }
}

assert.deepEqual(validateExpression('ALERT()', undefined, false), {
  valid: false,
  reason: 'Unknown builtin function: ALERT.',
});
assert.equal(validateExpression('ALERT()', undefined, true).valid, true);
assert.equal(validateExpression('window.alert(1)', { mode: 'safe' }).valid, false);
assert.equal(
  validateExpression('ABS(1)', { mode: 'custom', blockedPatterns: [/ABS/] }).valid,
  false
);

// Direct internal imports must work in a fresh process, without registry bootstrap.
for (const firstImport of ['security/validation.js', 'builtins/control/eval.js', 'index.js']) {
  const sourceRoot = new URL('../src/', import.meta.url);
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
        import assert from 'node:assert/strict';
        await import(${JSON.stringify(new URL(firstImport, sourceRoot).href)});
        const { validateExpression } = await import(${JSON.stringify(new URL('security/validation.js', sourceRoot).href)});
        const { EVAL, __setEvalContext, __clearEvalContext } = await import(${JSON.stringify(new URL('builtins/control/eval.js', sourceRoot).href)});
        assert.equal(validateExpression('ON()', undefined, true).valid, true);
        assert.equal(validateExpression('ON()', undefined, false).valid, false);
        __setEvalContext({ $input: 7 }, { suppressConsole: true });
        try { assert.equal(EVAL('$input'), 7); } finally { __clearEvalContext(); }
      `,
    ],
    { encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)) }
  );
  assert.equal(result.status, 0, `${firstImport}: ${result.stderr}`);
}

console.log('Builtin import isolation and security parity tests passed.');
