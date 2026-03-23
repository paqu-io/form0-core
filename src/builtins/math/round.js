import { BUILTIN_CONTEXTS, defineBuiltinMetadata } from '../builtin-metadata.js';

/**
 * @builtin ROUND
 * @description Rounds a number to a specified number of decimal places according to standard rounding rules
 * @param {number} value - The numeric value to be rounded
 * @param {number} places - The number of decimal places to round to
 * @returns {number} The value rounded to the specified number of decimal places
 * @example
 * // Returns 179.8
 * ROUND(179.848, 1)
 * @example
 * // Returns 900
 * ROUND(918.268, -2)
 * @example
 * // Returns 3
 * ROUND(3.14159, 0)
 * @example
 * // Returns 3.14
 * ROUND(3.14159, 2)
 */
export const ROUND_METADATA = defineBuiltinMetadata({
  name: 'ROUND',
  category: 'math',
  signature: 'ROUND(value, places)',
  description: 'Round a number to a fixed number of decimal places.',
  examples: ['ROUND($total, 2)'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const ROUND = (value, places) => {
  if (typeof value !== 'number' || typeof places !== 'number') {
    throw new Error('ROUND requires two numeric arguments');
  }

  const multiplier = Math.pow(10, places);
  return Math.round(value * multiplier) / multiplier;
};
