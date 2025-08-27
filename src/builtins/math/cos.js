/**
 * @builtin COS
 * @description Returns the cosine of a value, in radians
 * @param {number} value - The value for which to calculate the cosine
 * @returns {number} The cosine of the input value
 * @example
 * // Returns 0.15425144988758405
 * COS(30)
 * @example
 * // Returns 1
 * COS(0)
 * @example
 * // Returns -1
 * COS(Math.PI)
 */
export const COS = (value) => Math.cos(value);