/**
 * @builtin COUNTA
 * @description Returns a count of values in a dataset
 * @param {Array} values - An array of values to count
 * @returns {number} The total count of items in the array
 * @example
 * // Returns 5
 * COUNTA([11, 22, 33, 44, 55])
 * @example
 * // Returns 5 (counts all values regardless of type)
 * COUNTA(['a', 'b', 'c', 'd', 'e'])
 * @example
 * // Returns 4 (counts all items including null)
 * COUNTA([1, 'a', null, true])
 */
export const COUNTA = (values) => {
  // Handle null/undefined input
  if (!Array.isArray(values)) {
    return 0;
  }

  // Count all items in the array
  return values.length;
};
