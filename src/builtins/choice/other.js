export { OTHER_METADATA } from '../builtin-definitions.js';

/**
 * @builtin OTHER
 * Name, signature, description, examples, and contexts: see builtin-definitions.js.
 * @param {Object} choiceField - The choice field object (SingleChoiceField with choice array or MultiChoiceField with choices array) and other array
 * @returns {string|null} The other label if user entered an other option, null otherwise
 */
export const OTHER = (choiceField) => {
  // Handle null/undefined input
  if (!choiceField || typeof choiceField !== 'object') {
    return null;
  }

  // Validate structure - must have either choice array (SingleChoiceField) or choices array (MultiChoiceField)
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
