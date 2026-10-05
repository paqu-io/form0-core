export { COS_METADATA } from '../builtin-definitions.js';

/**
 * @builtin COS
 * Name, signature, description, examples, and contexts: see builtin-definitions.js.
 * @param {number} value - The value for which to calculate the cosine
 * @returns {number} The cosine of the input value
 */
export const COS = (value) => Math.cos(value);
