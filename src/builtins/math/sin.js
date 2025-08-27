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
export const SIN = (value) => Math.sin(value);