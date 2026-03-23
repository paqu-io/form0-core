import { BUILTIN_CONTEXTS, defineBuiltinMetadata } from '../builtin-metadata.js';

/**
 * @builtin CHOICEVALUE
 * @description Retrieves the currently selected choice field value, preserving the type (if the value is a number preserves the number type, otherwise string). If no selection it returns null.
 * @param {Object} choiceField - The choice field object with choice and other arrays
 * @returns {*} The selected choice value with preserved type, or null if no selection
 * @example
 * // Get the selected city value
 * CHOICEVALUE($city)
 * @example
 * // Use in conditional logic
 * IF(CHOICEVALUE($city) === "bogota", "Welcome to Bogotá!", "Welcome!")
 */
export const CHOICEVALUE_METADATA = defineBuiltinMetadata({
  name: 'CHOICEVALUE',
  category: 'choice',
  signature: 'CHOICEVALUE(fieldValue)',
  description: 'Return the selected choice value from a choice field.',
  examples: ['CHOICEVALUE($city)'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

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
