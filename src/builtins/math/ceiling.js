import { BUILTIN_CONTEXTS, defineBuiltinMetadata } from '../builtin-metadata.js';

/**
 * @builtin CEILING
 * @description Rounds a value up to the nearest integer multiple of factor
 * @param {number} value - The value to round up to the nearest integer multiple of factor
 * @param {number} [factor=1] - The number to whose multiples value will be rounded
 * @returns {number} The value rounded up to the nearest multiple of factor
 * @example
 * // Returns 139.9
 * CEILING(139.85, 0.1)
 * @example
 * // Returns 140
 * CEILING(139.001)
 * @example
 * // Returns 15
 * CEILING(12.3, 5)
 */
export const CEILING_METADATA = defineBuiltinMetadata({
  name: 'CEILING',
  category: 'math',
  signature: 'CEILING(value, factor)',
  description: 'Round a number up to the nearest multiple.',
  examples: ['CEILING($amount, 5)'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const CEILING = (value, factor = 1) => {
  if (factor === 0) {
    throw new Error('CEILING factor cannot be zero');
  }
  return Math.ceil(value / factor) * factor;
};
