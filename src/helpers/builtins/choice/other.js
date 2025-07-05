/**
 * @builtin OTHER
 * @description Retrieves the other label if user entered the other option, otherwise null
 * @param {Object} choiceField - The choice field object with choice and other arrays
 * @returns {string|null} The other label if user entered an other option, null otherwise
 * @example
 * // Get the other value
 * OTHER($city)
 * @example
 * // Use in conditional logic
 * IF(HASOTHER($city), "Custom city: " + OTHER($city), "No custom city entered")
 */
export const OTHER = (choiceField) => {
  // Handle null/undefined input
  if (!choiceField || typeof choiceField !== 'object') {
    return null;
  }
  
  // Validate structure
  if (!Array.isArray(choiceField.other)) {
    return null;
  }
  
  // Get the other entry (single selection)
  if (choiceField.other.length > 0) {
    const otherEntry = choiceField.other[0];
    if (otherEntry && otherEntry.label !== undefined) {
      return otherEntry.label;
    }
  }
  
  return null;
}; 