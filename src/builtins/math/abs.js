/**
 * @builtin ABS
 * @description Returns the absolute value of a number
 * @param {number} value - The number of which to return the absolute value
 * @returns {number} The absolute value of the input number
 * @example
 * // Returns 1
 * ABS(-1)
 * @example
 * // Returns 42
 * ABS(42)
 * @example
 * // Returns 3.14
 * ABS(-3.14)
 */
export const ABS = (value) => Math.abs(value);
