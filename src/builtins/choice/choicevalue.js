export { CHOICEVALUE_METADATA } from '../builtin-definitions.js';

/**
 * @builtin CHOICEVALUE
 * Name, signature, description, examples, and contexts: see builtin-definitions.js.
 * @param {Object} choiceField - The choice field object with choice and other arrays
 * @returns {*} The selected choice value with preserved type, or null if no selection
 */
export const CHOICEVALUE = (choiceField) => {
  // Handle null/undefined input
  if (!choiceField || typeof choiceField !== 'object') {
    return null;
  }

  // Validate structure
  if (!Array.isArray(choiceField.choice)) {
    return null;
  }

  // Get the selected choice (single selection)
  if (choiceField.choice.length > 0) {
    const selectedChoice = choiceField.choice[0];
    if (selectedChoice && selectedChoice.value !== undefined) {
      // Preserve type - if it's a number, keep it as number
      const value = selectedChoice.value;

      // Try to parse as number if it's a string that represents a number
      if (typeof value === 'string' && !isNaN(value) && !isNaN(parseFloat(value))) {
        // Check if it's an integer or float
        const numValue = parseFloat(value);
        return Number.isInteger(numValue) ? parseInt(value, 10) : numValue;
      }

      return value;
    }
  }

  return null;
};
