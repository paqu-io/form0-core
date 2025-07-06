/**
 * @builtin HASOTHER
 * @description Returns true if user entered an other option, false otherwise. Works with both SingleChoiceField and MultiChoiceField.
 * @param {Object} choiceField - The choice field object (SingleChoiceField with choice array or MultiChoiceField with choices array) and other array
 * @returns {boolean} True if user entered an other option, false otherwise
 * @example
 * // Check if user entered other option in single choice field
 * HASOTHER($city)
 * @example
 * // Check if user entered other option in multi choice field
 * HASOTHER($colors)
 * @example
 * // Use in conditional logic
 * IF(HASOTHER($city), "Custom city: " + OTHER($city), "Selected city: " + CHOICELABEL($city))
 */
export const HASOTHER = (choiceField) => {
  // Handle null/undefined input
  if (!choiceField || typeof choiceField !== 'object') {
    return false;
  }
  
  // Validate structure - must have either choice array (SingleChoiceField) or choices array (MultiChoiceField)
  const hasChoiceArray = Array.isArray(choiceField.choice);
  const hasChoicesArray = Array.isArray(choiceField.choices);
  
  if (!hasChoiceArray && !hasChoicesArray) {
    return false;
  }
  
  // Validate other array structure
  if (!Array.isArray(choiceField.other)) {
    return false;
  }
  
  // Check if there are any other entries
  return choiceField.other.length > 0;
}; 