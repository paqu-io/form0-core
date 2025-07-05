/**
 * @builtin OTHER
 * @description Retrieves the other label if user entered the other option, otherwise null. Works with both ChoiceField and MultiChoiceField.
 * @param {Object} choiceField - The choice field object (ChoiceField with choice array or MultiChoiceField with choices array) and other array
 * @returns {string|null} The other label if user entered an other option, null otherwise
 * @example
 * // Get the other value from single choice field
 * OTHER($city)
 * @example
 * // Get the other value from multi choice field
 * OTHER($colors)
 * @example
 * // Use in conditional logic
 * IF(HASOTHER($city), "Custom city: " + OTHER($city), "No custom city entered")
 */
export const OTHER = (choiceField) => {
  // Handle null/undefined input
  if (!choiceField || typeof choiceField !== 'object') {
    return null;
  }
  
  // Validate structure - must have either choice array (ChoiceField) or choices array (MultiChoiceField)
  const hasChoiceArray = Array.isArray(choiceField.choice);
  const hasChoicesArray = Array.isArray(choiceField.choices);
  
  if (!hasChoiceArray && !hasChoicesArray) {
    return null;
  }
  
  // Validate other array structure
  if (!Array.isArray(choiceField.other)) {
    return null;
  }
  
  // Get the other entry (single selection - user can only add 1 other option)
  if (choiceField.other.length > 0) {
    const otherEntry = choiceField.other[0];
    if (otherEntry && otherEntry.label !== undefined) {
      return otherEntry.label;
    }
  }
  
  return null;
}; 