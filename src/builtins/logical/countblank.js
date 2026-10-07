export { COUNTBLANK_METADATA } from '../builtin-definitions.js';

/**
 * @builtin COUNTBLANK
 * Name, signature, description, examples, and contexts: see builtin-definitions.js.
 * @param {Array} values - An array of items to check
 * @returns {number} The count of blank items in the array
 */
export const COUNTBLANK = (values) => {
  // Handle null/undefined input
  if (!Array.isArray(values)) {
    return 0;
  }

  // Count null, undefined, and empty strings as blank
  return values.filter((value) => value === null || value === undefined || value === '').length;
};
