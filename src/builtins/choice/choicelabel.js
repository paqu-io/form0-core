/**
 * @builtin CHOICELABEL
 * @description Retrieves the currently selected choice field label, preserving the type (if the label is a number preserves the number type, otherwise string). If no selection it returns null.
 * @param {Object} choiceField - The choice field object with choice and other arrays
 * @returns {*} The selected choice label with preserved type, or null if no selection
 * @example
 * // Get the selected city label
 * CHOICELABEL($city)
 * @example
 * // Use in display logic
 * "You selected: " + CHOICELABEL($city)
 */
export const CHOICELABEL = (choiceField) => {
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
    if (selectedChoice && selectedChoice.label !== undefined) {
      // Preserve type - if it's a number, keep it as number
      const label = selectedChoice.label;

      // Try to parse as number if it's a string that represents a number
      if (typeof label === 'string' && !isNaN(label) && !isNaN(parseFloat(label))) {
        // Check if it's an integer or float
        const numLabel = parseFloat(label);
        return Number.isInteger(numLabel) ? parseInt(label, 10) : numLabel;
      }

      return label;
    }
  }

  return null;
};
