/**
 * @builtin DATANAMES
 * @description Returns the data names of form fields, optionally filtered by field type
 * @param {string} type - Optional field type to filter by (e.g., 'TextField', 'RepeatableSection', etc.). Defaults to 'any' (all fields)
 * @returns {Array<string>} Array of field data names
 * @example
 * // Get all field data names
 * DATANAMES()
 * @example
 * // Get only RepeatableSection data names
 * DATANAMES('RepeatableSection')
 * @example
 * // Get only TextField data names
 * DATANAMES('TextField')
 */

// Global schema context for DATANAMES() - set during expression evaluation
let _dataNamesSchema = null;

/**
 * Set the schema context for DATANAMES() during expression evaluation
 * Called internally by the expression evaluator
 */
export function __setDataNamesContext(schema) {
  _dataNamesSchema = schema;
}

/**
 * Clear the DATANAMES() context after expression evaluation
 * Called internally by the expression evaluator
 */
export function __clearDataNamesContext() {
  _dataNamesSchema = null;
}

export const DATANAMES = (type = 'any') => {
  // Validate schema context
  if (!_dataNamesSchema) {
    console.warn('[form0] DATANAMES() requires schema context to be set');
    return [];
  }

  // Validate schema structure
  if (!_dataNamesSchema.elements || !Array.isArray(_dataNamesSchema.elements)) {
    console.warn('[form0] DATANAMES() schema must have an elements array');
    return [];
  }

  // Helper function to recursively extract field data names
  const extractDataNames = (elements, filterType) => {
    const dataNames = [];

    for (const element of elements) {
      // Skip elements without data_name (like LabelField)
      if (!element.data_name) {
        continue;
      }

      // Check if element matches the filter type
      const matchesFilter = filterType === 'any' || element.type === filterType;

      if (matchesFilter) {
        dataNames.push(element.data_name);
      }

      // Recursively process nested elements (for Sections and RepeatableSections)
      if (element.elements && Array.isArray(element.elements)) {
        dataNames.push(...extractDataNames(element.elements, filterType));
      }
    }

    return dataNames;
  };

  // Extract and return data names
  return extractDataNames(_dataNamesSchema.elements, type);
};
