import assert from 'node:assert/strict';

import { getBuiltinDefinitions } from '../src/index.js';

(() => {
  const builtinDefinitions = getBuiltinDefinitions();
  const definitionsByName = new Map(
    builtinDefinitions.map((definition) => [definition.name, definition])
  );

  assert.equal(definitionsByName.get('IF')?.category, 'logical');
  assert.deepEqual(definitionsByName.get('IF')?.contexts, ['calculation', 'event']);
  assert.deepEqual(definitionsByName.get('ALERT')?.contexts, ['event']);
  assert.deepEqual(definitionsByName.get('SETRESULT')?.contexts, ['calculation']);
  assert.equal(definitionsByName.get('COUNT')?.signature, 'COUNT(values)');
  assert.equal(definitionsByName.get('FORM')?.signature, 'FORM()');
  assert.deepEqual(definitionsByName.get('SETVALUE').operation.effects, ['record-write']);
  definitionsByName.get('SETVALUE').operation.effects.push('presentation');
  assert.deepEqual(
    getBuiltinDefinitions().find((entry) => entry.name === 'SETVALUE').operation.effects,
    ['record-write']
  );
})();

(() => {
  const builtinDefinitions = getBuiltinDefinitions();
  const evalDefinition = builtinDefinitions.find((definition) => definition.name === 'EVAL');
  assert.ok(evalDefinition);

  evalDefinition.examples.push('mutated');
  evalDefinition.contexts.push('calculation');

  const freshDefinitions = getBuiltinDefinitions();
  const freshEvalDefinition = freshDefinitions.find((definition) => definition.name === 'EVAL');

  assert.ok(freshEvalDefinition);
  assert.equal(freshEvalDefinition.examples.includes('mutated'), false);
  assert.deepEqual(freshEvalDefinition.contexts, ['calculation', 'event']);
})();

// COUNTA retains its established all-items behavior, including blank entries.
assert.equal(
  getBuiltinDefinitions().find(({ name }) => name === 'COUNTA').description,
  'Count all items in an array.'
);
