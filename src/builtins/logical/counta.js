export { COUNTA_METADATA } from '../builtin-definitions.js';

/**
 * @builtin COUNTA
 * Name, signature, description, examples, and contexts: see builtin-definitions.js.
 * @param {Array} values - An array of values to count
 * @returns {number} The total count of items in the array
 */
export const COUNTA = (values) => {
  // Handle null/undefined input
  if (!Array.isArray(values)) {
    return 0;
  }

  // Count all items in the array
  return values.length;
};
