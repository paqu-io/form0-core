export { CEILING_METADATA } from '../builtin-definitions.js';

/**
 * @builtin CEILING
 * Name, signature, description, examples, and contexts: see builtin-definitions.js.
 * @param {number} value - The value to round up to the nearest integer multiple of factor
 * @param {number} [factor=1] - The number to whose multiples value will be rounded
 * @returns {number} The value rounded up to the nearest multiple of factor
 */
export const CEILING = (value, factor = 1) => {
  if (factor === 0) {
    throw new Error('CEILING factor cannot be zero');
  }
  return Math.ceil(value / factor) * factor;
};
