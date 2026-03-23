import { BUILTIN_CONTEXTS, defineBuiltinMetadata } from '../builtin-metadata.js';

/**
 * @builtin SIN
 * @description Returns the sine of a value, in radians
 * @param {number} value - The value for which to calculate the sine
 * @returns {number} The sine of the input value
 * @example
 * // Returns -0.9880316240928618
 * SIN(30)
 * @example
 * // Returns 0
 * SIN(0)
 * @example
 * // Returns 1
 * SIN(Math.PI / 2)
 */
export const SIN_METADATA = defineBuiltinMetadata({
  name: 'SIN',
  category: 'math',
  signature: 'SIN(value)',
  description: 'Return the sine of a value in radians.',
  examples: ['SIN($angle_radians)'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const SIN = (value) => Math.sin(value);
