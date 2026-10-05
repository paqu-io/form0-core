export { ABS_METADATA } from '../builtin-definitions.js';

/**
 * @builtin ABS
 * Name, signature, description, examples, and contexts: see builtin-definitions.js.
 * @param {number} value - The number of which to return the absolute value
 * @returns {number} The absolute value of the input number
 */
export const ABS = (value) => Math.abs(value);
