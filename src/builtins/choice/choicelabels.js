export { CHOICELABELS_METADATA } from '../builtin-definitions.js';

/**
 * @builtin CHOICELABELS
 * Name, signature, description, examples, and contexts: see builtin-definitions.js.
 * @param {Object} multiChoiceField - The multi choice field object with choices and other arrays
 * @returns {Array} Array of selected choice labels with preserved types
 */
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
