export { SIN_METADATA } from '../builtin-definitions.js';

/**
 * @builtin SIN
 * Name, signature, description, examples, and contexts: see builtin-definitions.js.
 * @param {number} value - The value for which to calculate the sine
 * @returns {number} The sine of the input value
 */
export const SIN = (value) => Math.sin(value);
