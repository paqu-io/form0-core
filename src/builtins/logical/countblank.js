/**
 * @builtin COUNTBLANK
 * @description Returns the number of blank values in a dataset
 * @param {Array} values - An array of items to check
 * @returns {number} The count of blank items in the array
 * @example
 * // Returns 3
 * COUNTBLANK([null, null, '', 1])
 * @example
 * // Returns 2
 * COUNTBLANK([undefined, '', 'a', 0])
 * @example
 * // Returns 0 (no blank values)
 * COUNTBLANK([1, 2, 'a', true])
 */
export const COUNTBLANK = (values) => {
  // Handle null/undefined input
  if (!Array.isArray(values)) {
    return 0;
  }

  // Count null, undefined, and empty strings as blank
  return values.filter(
    (value) => value === null || value === undefined || value === ''
  ).length;
};
