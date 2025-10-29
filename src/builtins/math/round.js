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
export const ROUND = (value, places) => {
  if (typeof value !== 'number' || typeof places !== 'number') {
    throw new Error('ROUND requires two numeric arguments');
  }
  
  const multiplier = Math.pow(10, places);
  return Math.round(value * multiplier) / multiplier;
};