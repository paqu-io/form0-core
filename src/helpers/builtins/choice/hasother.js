/**
 * @builtin HASOTHER
 * @description Returns true if user entered an other option, false otherwise
 * @param {Object} choiceField - The choice field object with choice and other arrays
 * @returns {boolean} True if user entered an other option, false otherwise
 * @example
 * // Check if user entered other option
 * HASOTHER($city)
 * @example
 * // Use in conditional logic
 * IF(HASOTHER($city), "Custom city: " + OTHER($city), "Selected city: " + CHOICELABEL($city))
 */
export const HASOTHER = (choiceField) => {
  // Handle null/undefined input
  if (!choiceField || typeof choiceField !== 'object') {
    return false;
  }
  
  // Validate structure
  if (!Array.isArray(choiceField.other)) {
    return false;
  }
  
  // Check if there are any other entries
  return choiceField.other.length > 0;
}; 