export { CHOICEVALUES_METADATA } from '../builtin-definitions.js';

/**
 * @builtin CHOICEVALUES
 * Name, signature, description, examples, and contexts: see builtin-definitions.js.
 * @param {Object} multiChoiceField - The multi choice field object with choices and other arrays
 * @returns {Array} Array of selected choice values with preserved types
 */
export const CHOICEVALUES = (multiChoiceField) => {
  // Handle null/undefined input
  if (!multiChoiceField || typeof multiChoiceField !== 'object') {
    return [];
  }

  // Validate structure
  if (!Array.isArray(multiChoiceField.choices)) {
    return [];
  }

  // Get all selected choices
  const values = [];
  for (const choice of multiChoiceField.choices) {
    if (choice && choice.value !== undefined) {
      // Preserve type - if it's a number, keep it as number
      const value = choice.value;

      // Try to parse as number if it's a string that represents a number
      if (typeof value === 'string' && !isNaN(value) && !isNaN(parseFloat(value))) {
        // Check if it's an integer or float
        const numValue = parseFloat(value);
        values.push(Number.isInteger(numValue) ? parseInt(value, 10) : numValue);
      } else {
        values.push(value);
      }
    }
  }

  return values;
};
