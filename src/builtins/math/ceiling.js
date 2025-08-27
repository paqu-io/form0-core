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
export const CEILING = (value, factor = 1) => {
  if (factor === 0) {
    throw new Error('CEILING factor cannot be zero');
  }
  return Math.ceil(value / factor) * factor;
};
