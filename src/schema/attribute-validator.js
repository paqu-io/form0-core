/**
 * Generic attribute validation utility
 * Validates individual attributes against their specifications
 */

/**
 * Validates a single attribute against its definition
 * @param {string} name - The attribute name
 * @param {object} definition - The attribute definition from field spec
 * @param {any} value - The value to validate
 * @param {object} field - The complete field object for dependent validation
 * @returns {object} - Validation result with isValid and error
 */
export function validateAttribute(name, definition, value, field) {
  // Check if required attribute is missing (allow null if nullable is true)
  if (definition.required && value === undefined) {
    return { isValid: false, error: `Missing required attribute: ${name}` };
  }

  // Skip validation for null values if nullable is true
  if (value === null && definition.nullable !== false) {
    return { isValid: true };
  }

  // Check if value is null when nullable is false
  if (value === null && definition.nullable === false) {
    return { isValid: false, error: `Attribute ${name} cannot be null` };
  }

  // Type validation
  const typeValidation = validateAttributeType(value, definition.type);
  if (!typeValidation.isValid) {
    return { isValid: false, error: `Attribute ${name}: ${typeValidation.error}` };
  }

  // Enum validation
  if (definition.allowedValues && !definition.allowedValues.includes(value)) {
    return { isValid: false, error: `Attribute ${name} must be one of: ${definition.allowedValues.join(', ')}` };
  }

  // Specific value validation
  if (definition.value !== undefined && value !== definition.value) {
    return { isValid: false, error: `Attribute ${name} must be "${definition.value}"` };
  }

  // Dependent validation
  if (definition.dependentOn && field) {
    const dependentValue = field[definition.dependentOn];
    if (value !== null && value !== undefined && (dependentValue === null || dependentValue === undefined)) {
      return { isValid: false, error: `Attribute ${name} cannot be set when ${definition.dependentOn} is null or missing` };
    }
  }

  // notNullOn
  if (definition.notNullOn) {
    for (const [depAttr, depValue] of Object.entries(definition.notNullOn)) {
      if (typeof depValue === 'function' ? depValue(field[depAttr]) : field[depAttr] === depValue) {
        if (value == null) {
          return { isValid: false, error: `Attribute ${name} must not be null when ${depAttr} is ${depValue}` };
        }
      }
    }
  }

  // notTrueOn
  if (definition.notTrueOn) {
    for (const [depAttr, depValue] of Object.entries(definition.notTrueOn)) {
      if (typeof depValue === 'function' ? depValue(field[depAttr]) : field[depAttr] === depValue) {
        if (value === true) {
          return { isValid: false, error: `Attribute ${name} must not be true when ${depAttr} is ${depValue}` };
        }
      }
    }
  }

  // notFalseOn
  if (definition.notFalseOn) {
    for (const [depAttr, depValue] of Object.entries(definition.notFalseOn)) {
      if (typeof depValue === 'function' ? depValue(field[depAttr]) : field[depAttr] === depValue) {
        if (value === false) {
          return { isValid: false, error: `Attribute ${name} must not be false when ${depAttr} is ${depValue}` };
        }
      }
    }
  }

  return { isValid: true };
}

/**
 * Checks if value matches expected type
 * @param {any} value - The value to check
 * @param {string} expectedType - The expected type
 * @returns {object} - Validation result with isValid and error
 */
export function validateAttributeType(value, expectedType) {
  switch (expectedType) {
    case 'string':
      if (typeof value !== 'string') {
        return { isValid: false, error: 'must be a string' };
      }
      break;
      
    case 'number':
      if (typeof value !== 'number') {
        return { isValid: false, error: 'must be a number' };
      }
      break;
      
    case 'boolean':
      if (typeof value !== 'boolean') {
        return { isValid: false, error: 'must be a boolean' };
      }
      break;
      
    case 'array':
      if (!Array.isArray(value)) {
        return { isValid: false, error: 'must be an array' };
      }
      break;
      
    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return { isValid: false, error: 'must be an object' };
      }
      break;
      
    case 'null':
      if (value !== null) {
        return { isValid: false, error: 'must be null' };
      }
      break;
      
    default:
      return { isValid: false, error: `unknown type: ${expectedType}` };
  }
  
  return { isValid: true };
}

/**
 * Validates enum values
 * @param {any} value - The value to validate
 * @param {Array} allowedValues - Array of allowed values
 * @returns {boolean} - True if valid, false otherwise
 */
export function validateEnum(value, allowedValues) {
  return allowedValues.includes(value);
}

/**
 * Validates string patterns using regex
 * @param {string} value - The string to validate
 * @param {string} pattern - The regex pattern
 * @returns {object} - Validation result with isValid and error
 */
export function validatePattern(value, pattern) {
  if (typeof value !== 'string') {
    return { isValid: false, error: 'must be a string' };
  }
  
  try {
    const re = new RegExp(pattern);
    if (!re.test(value)) {
      return { isValid: false, error: 'does not match pattern' };
    }
  } catch (e) {
    return { isValid: false, error: 'invalid pattern' };
  }
  
  return { isValid: true };
}

/**
 * Validates numeric ranges
 * @param {number} value - The number to validate
 * @param {number} min - Minimum value (optional)
 * @param {number} max - Maximum value (optional)
 * @returns {object} - Validation result with isValid and error
 */
export function validateRange(value, min, max) {
  if (typeof value !== 'number') {
    return { isValid: false, error: 'must be a number' };
  }
  
  if (min !== undefined && value < min) {
    return { isValid: false, error: `must be at least ${min}` };
  }
  
  if (max !== undefined && value > max) {
    return { isValid: false, error: `must be at most ${max}` };
  }
  
  return { isValid: true };
}

/**
 * Validates array length
 * @param {Array} value - The array to validate
 * @param {number} minLength - Minimum length (optional)
 * @param {number} maxLength - Maximum length (optional)
 * @returns {object} - Validation result with isValid and error
 */
export function validateArrayLength(value, minLength, maxLength) {
  if (!Array.isArray(value)) {
    return { isValid: false, error: 'must be an array' };
  }
  
  if (minLength !== undefined && value.length < minLength) {
    return { isValid: false, error: `must have at least ${minLength} items` };
  }
  
  if (maxLength !== undefined && value.length > maxLength) {
    return { isValid: false, error: `must have at most ${maxLength} items` };
  }
  
  return { isValid: true };
} 