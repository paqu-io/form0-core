export { IF_METADATA } from '../builtin-definitions.js';

/**
 * @builtin IF
 * Name, signature, description, examples, and contexts: see builtin-definitions.js.
 * @param {boolean} condition - The condition to evaluate
 * @param {*} trueValue - Value returned if condition is true
 * @param {*} falseValue - Value returned if condition is false
 * @returns {*} Either trueValue or falseValue
 */
export const IF = (cond, a, b) => (cond ? a : b);
