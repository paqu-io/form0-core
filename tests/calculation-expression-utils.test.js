import assert from 'node:assert/strict';

import { normalizeInlineCalculationExpression } from '../src/utilities/calculation-expression-utils.js';

assert.equal(normalizeInlineCalculationExpression(null), '');
assert.equal(normalizeInlineCalculationExpression('age + 1'), 'age + 1');
assert.equal(normalizeInlineCalculationExpression('age + 1   '), 'age + 1   ');
assert.equal(normalizeInlineCalculationExpression('age + 1;;;'), 'age + 1');
assert.equal(normalizeInlineCalculationExpression('age + 1;;; \t\n'), 'age + 1');
assert.equal(normalizeInlineCalculationExpression('age; + 1'), 'age; + 1');
assert.equal(normalizeInlineCalculationExpression('age; ;  '), 'age; ');

const adversarialExpression = `${';'.repeat(100_000)}x`;
assert.equal(normalizeInlineCalculationExpression(adversarialExpression), adversarialExpression);

console.log('calculation expression utility tests passed');
