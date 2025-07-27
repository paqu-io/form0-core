// Field utility functions for form0-core

// =============================================================================
// Field Flattening Utilities
// =============================================================================

export function flattenFields(elements) {
  return elements.flatMap((el) => {
    if (el.type === 'Section' || el.type === 'RepeatableSection') {
      return [el, ...flattenFields(el.elements)];
    }

    return [el];
  });
}

// =============================================================================
// Choice Field Utilities
// =============================================================================

/**
 * Converts accented characters to their basic Latin equivalents
 * @param {string} str - The string to normalize
 * @returns {string} - The normalized string
 */
function normalizeAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Generates a valid value from a label following the rules:
 * - Convert accents/diacritics to regular letters
 * - Convert spaces and dashes to underscores
 * - Remove special characters
 * - Convert to lowercase
 * - Ensure it matches ^[a-z0-9_]+$
 * @param {string} label - The label to convert
 * @returns {string} - The generated value
 */
export function generateValueFromLabel(label) {
  if (!label || typeof label !== 'string') {
    return '';
  }
  
  // Normalize accents and convert to lowercase
  let value = normalizeAccents(label).toLowerCase();
  
  // Convert spaces and dashes to underscores
  value = value.replace(/[\s-]+/g, '_');
  
  // Remove all characters that are not a-z, 0-9, or underscore
  value = value.replace(/[^a-z0-9_]/g, '');
  
  // Remove consecutive underscores and trim underscores from start/end
  value = value.replace(/_+/g, '_').replace(/^_|_$/g, '');
  
  // If the result is empty, generate a fallback
  if (!value) {
    value = 'option';
  }
  
  return value;
}

/**
 * Validates that a value follows the SingleChoiceField value rules
 * @param {string} value - The value to validate
 * @returns {boolean} - True if valid, false otherwise
 */
export function isValidChoiceValue(value) {
  if (!value || typeof value !== 'string') {
    return false;
  }
  return /^[a-z0-9_]+$/.test(value);
}

/**
 * Processes SingleChoiceField and BooleanField choices to auto-generate missing values
 * @param {Array} choices - Array of choice objects
 * @returns {Array} - Array of choices with generated values
 */
export function processChoiceFieldChoices(choices) {
  if (!Array.isArray(choices)) {
    return [];
  }
  
  const processedChoices = [];
  const usedValues = new Set();
  
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object' || !choice.label) {
      continue;
    }
    
    let value = choice.value;
    
    // Generate value if not provided
    if (!value) {
      value = generateValueFromLabel(choice.label);
    }
    
    // Ensure uniqueness by adding numbers if needed
    let finalValue = value;
    let counter = 1;
    while (usedValues.has(finalValue)) {
      finalValue = `${value}_${counter}`;
      counter++;
    }
    
    usedValues.add(finalValue);
    processedChoices.push({
      ...choice,
      value: finalValue,
    });
  }
  
  return processedChoices;
}

/**
 * Validates that all values in a SingleChoiceField or BooleanField are unique and valid
 * @param {Array} choices - Array of choice objects
 * @returns {Object} - Validation result with isValid and errors
 */
export function validateChoiceFieldChoices(choices) {
  if (!Array.isArray(choices)) {
    return { isValid: false, errors: ['choices must be an array'] };
  }
  
  const errors = [];
  const values = new Set();
  
  for (let i = 0; i < choices.length; i++) {
    const choice = choices[i];
    
    if (!choice || typeof choice !== 'object') {
      errors.push(`Choice at index ${i} must be an object`);
      continue;
    }
    
    if (!choice.label || typeof choice.label !== 'string') {
      errors.push(`Choice at index ${i} must have a label`);
      continue;
    }
    
    if (choice.value !== undefined) {
      if (!isValidChoiceValue(choice.value)) {
        errors.push(`Choice at index ${i} has invalid value "${choice.value}". Values must contain only a-z, 0-9, and underscores`);
      }
      
      if (values.has(choice.value)) {
        errors.push(`Duplicate value "${choice.value}" found in choices`);
      } else {
        values.add(choice.value);
      }
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Processes MultiChoiceField choices to auto-generate missing values (same as SingleChoiceField)
 * This is an alias for processChoiceFieldChoices for consistency
 * @param {Array} choices - Array of choice objects
 * @returns {Array} - Array of choices with generated values
 */
export function processMultiChoiceFieldChoices(choices) {
  return processChoiceFieldChoices(choices);
}

/**
 * Validates that all values in a MultiChoiceField choices are unique and valid (same as SingleChoiceField)
 * This is an alias for validateChoiceFieldChoices for consistency
 * @param {Array} choices - Array of choice objects
 * @returns {Object} - Validation result with isValid and errors
 */
export function validateMultiChoiceFieldChoices(choices) {
  return validateChoiceFieldChoices(choices);
} 