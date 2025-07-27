/**
 * @builtin CHOICEVALUES
 * @description Retrieves an array of all selected choice field values from a MultiChoiceField, preserving the type of each value. Returns an empty array if no selections.
 * @param {Object} multiChoiceField - The multi choice field object with choices and other arrays
 * @returns {Array} Array of selected choice values with preserved types
 * @example
 * // Get all selected color values
 * CHOICEVALUES($colors)
 * @example
 * // Check if "red" is selected
 * CHOICEVALUES($colors).includes("red")
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