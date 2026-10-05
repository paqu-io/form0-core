export { COUNT_METADATA } from '../builtin-definitions.js';

/**
 * @builtin COUNT
 * Name, signature, description, examples, and contexts: see builtin-definitions.js.
 * @param {Array} values - An array of values to count
 * @returns {number} The count of numeric values in the array
 */
export const COUNT = (values) => {
  // Handle null/undefined input
  if (!Array.isArray(values)) {
    return 0;
  }

  // Count only numeric values
  return values.filter((value) => typeof value === 'number' && !isNaN(value)).length;
};
