import assert from 'node:assert/strict';
import { parse } from 'acorn';

import { BUILTIN_DEFINITIONS } from '../src/builtins/builtin-definitions.js';
import { validateExpression } from '../src/security/validation.js';

// builtin-definitions.js is the authoritative source for builtin examples. Editor tooling shows
// them as completions, so every example must be valid JavaScript and must pass expression
// validation in each context where the builtin is available.
for (const definition of BUILTIN_DEFINITIONS) {
  assert.ok(
    Array.isArray(definition.examples) && definition.examples.length > 0,
    `${definition.name}: expected at least one example`
  );

  for (const example of definition.examples) {
    assert.doesNotThrow(
      () => parse(example, { ecmaVersion: 'latest' }),
      `${definition.name}: example is not valid JavaScript: ${example}`
    );

    for (const context of definition.contexts) {
      for (const mode of ['trusted', 'safe']) {
        const result = validateExpression(
          example,
          { mode, validateBuiltins: true },
          context === 'event'
        );
        assert.equal(
          result.valid,
          true,
          `${definition.name} (${context}, ${mode}): ${example} -> ${result.reason}`
        );
      }
    }
  }
}

console.log('Builtin catalog example tests passed.');
