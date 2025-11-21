/**
 * @builtin COUNT
 * @description Returns a count of the number of numeric values in a dataset
 * @param {Array} values - An array of values to count
 * @returns {number} The count of numeric values in the array
 * @example
 * // Returns 5
 * COUNT([11, 22, 33, 44, 55])
 * @example
 * // Returns 0 (only counts numeric values)
 * COUNT(['a', 'b', 'c', 'd', 'e'])
 * @example
 * // Returns 3 (mixed array)
 * COUNT([1, 'a', 2, null, 3])
 */
export const COUNT = (values) => {
  // Handle null/undefined input
  if (!Array.isArray(values)) {
    return 0;
  }

  // Count only numeric values
  return values.filter((value) => typeof value === 'number' && !isNaN(value)).length;
};
