import { BUILTIN_CONTEXTS, defineBuiltinMetadata } from '../builtin-metadata.js';

/**
 * @builtin CHOICELABELS
 * @description Retrieves an array of all selected choice field labels from a MultiChoiceField, preserving the type of each label. Returns an empty array if no selections.
 * @param {Object} multiChoiceField - The multi choice field object with choices and other arrays
 * @returns {Array} Array of selected choice labels with preserved types
 * @example
 * // Get all selected color labels
 * CHOICELABELS($colors)
 * @example
 * // Display selected colors
 * "Selected colors: " + CHOICELABELS($colors).join(", ")
 */
export const CHOICELABELS_METADATA = defineBuiltinMetadata({
  name: 'CHOICELABELS',
  category: 'choice',
  signature: 'CHOICELABELS(fieldValue)',
  description: 'Return all selected labels from a MultiChoiceField.',
  examples: ['CHOICELABELS($colors)'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const CHOICELABELS = (multiChoiceField) => {
  // Handle null/undefined input
  if (!multiChoiceField || typeof multiChoiceField !== 'object') {
    return [];
  }

  // Validate structure
  if (!Array.isArray(multiChoiceField.choices)) {
    return [];
  }

  // Get all selected choices
  const labels = [];
  for (const choice of multiChoiceField.choices) {
    if (choice && choice.label !== undefined) {
      // Preserve type - if it's a number, keep it as number
      const label = choice.label;

      // Try to parse as number if it's a string that represents a number
      if (typeof label === 'string' && !isNaN(label) && !isNaN(parseFloat(label))) {
        // Check if it's an integer or float
        const numLabel = parseFloat(label);
        labels.push(Number.isInteger(numLabel) ? parseInt(label, 10) : numLabel);
      } else {
        labels.push(label);
      }
    }
  }

  return labels;
};
