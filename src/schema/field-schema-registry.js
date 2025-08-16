import { FIELD_SPECS } from './field-specs.js';
import { validateAttribute } from './attribute-validator.js';

/**
 * Validates a field definition against its specification
 * @param {object} field - The field definition to validate
 * @returns {object} - Validation result with isValid and errors array
 */
export function validateFieldSchema(field) {
  const errors = [];

  // Check if field type is supported
  if (!FIELD_SPECS[field.type]) {
    return { isValid: false, errors: [`Unsupported field type: ${field.type}`] };
  }

  const spec = FIELD_SPECS[field.type];

  // Validate all attributes present on the field
  for (const [attrName, attrValue] of Object.entries(field)) {
    const attrDef = spec.attributes[attrName];

    if (!attrDef) {
      // If attribute is not defined in spec, it's forbidden
      errors.push(
        `Field "${field.data_name}" (${field.type}) does not support ${attrName} attribute`
      );
      continue;
    }

    const validation = validateAttribute(attrName, attrDef, attrValue, field);
    if (!validation.isValid) {
      errors.push(`Field "${field.data_name}": ${validation.error}`);
    }
  }

  // Check for missing required attributes
  for (const [attrName, attrDef] of Object.entries(spec.attributes)) {
    if (attrDef.required && !(attrName in field)) {
      errors.push(`Field "${field.data_name}": Missing required attribute: ${attrName}`);
    }
  }

  // Run cross-attribute validators
  for (const validator of spec.schemaValidators) {
    const result = validator(field);
    if (!result.isValid) {
      errors.push(result.error);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validates all attributes for a field against its specification
 * @param {object} field - The field definition
 * @param {object} spec - The field specification
 * @returns {object} - Validation result with isValid and errors array
 */
export function validateFieldAttributes(field, spec) {
  const errors = [];

  for (const [attrName, attrValue] of Object.entries(field)) {
    const attrDef = spec.attributes[attrName];

    if (!attrDef) {
      continue; // Skip attributes not defined in spec
    }

    const validation = validateAttribute(attrName, attrDef, attrValue, field);
    if (!validation.isValid) {
      errors.push(`Field "${field.data_name}": ${validation.error}`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Runs cross-attribute validation functions for a field
 * @param {object} field - The field definition
 * @param {object} spec - The field specification
 * @returns {object} - Validation result with isValid and errors array
 */
export function runSchemaValidators(field, spec) {
  const errors = [];

  for (const validator of spec.schemaValidators) {
    const result = validator(field);
    if (!result.isValid) {
      errors.push(result.error);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validates default value for a field
 * @param {object} field - The field definition
 * @param {any} defaultValue - The default value to validate
 * @returns {object} - Validation result with isValid and error
 */
export function validateDefaultValue(field, defaultValue) {
  const spec = FIELD_SPECS[field.type];
  if (!spec) {
    return { isValid: false, error: `Unsupported field type: ${field.type}` };
  }

  switch (field.type) {
    case 'TextField':
      if (typeof defaultValue !== 'string') {
        return { isValid: false, error: 'TextField default_value must be a string' };
      }
      break;

    case 'NumericField':
      if (typeof defaultValue !== 'number') {
        return { isValid: false, error: 'NumericField default_value must be a number' };
      }
      // Check format constraints
      if (field.format === 'integer' && !Number.isInteger(defaultValue)) {
        return {
          isValid: false,
          error: 'NumericField with integer format must have integer default_value',
        };
      }
      // Check min/max constraints
      if (field.min !== null && field.min !== undefined && defaultValue < field.min) {
        return {
          isValid: false,
          error: `NumericField default_value ${defaultValue} is less than min ${field.min}`,
        };
      }
      if (field.max !== null && field.max !== undefined && defaultValue > field.max) {
        return {
          isValid: false,
          error: `NumericField default_value ${defaultValue} is greater than max ${field.max}`,
        };
      }
      break;

    case 'SingleChoiceField':
      if (typeof defaultValue !== 'string') {
        return { isValid: false, error: 'SingleChoiceField default_value must be a string' };
      }
      // Check if the default value exists in choices
      const choiceValues = field.choices.map((choice) => choice.value);
      if (!choiceValues.includes(defaultValue)) {
        return {
          isValid: false,
          error: `SingleChoiceField default_value "${defaultValue}" not found in choices`,
        };
      }
      break;

    case 'MultiChoiceField':
      if (!Array.isArray(defaultValue)) {
        return {
          isValid: false,
          error: 'MultiChoiceField default_value must be an array of strings',
        };
      }
      // Check if all default values exist in choices
      const multiChoiceValues = field.choices.map((choice) => choice.value);
      for (const value of defaultValue) {
        if (typeof value !== 'string') {
          return {
            isValid: false,
            error: 'MultiChoiceField default_value array must contain only strings',
          };
        }
        if (!multiChoiceValues.includes(value)) {
          return {
            isValid: false,
            error: `MultiChoiceField default_value "${value}" not found in choices`,
          };
        }
      }
      break;

    case 'DateField':
    case 'TimeField':
      if (defaultValue !== 'now') {
        return { isValid: false, error: `${field.type} default_value can only be 'now' or null` };
      }
      break;

    case 'CalculatedField':
    case 'Section':
    case 'RepeatableSection':
      // These field types don't support default_value
      return { isValid: false, error: `${field.type} does not support default_value` };

    case 'BooleanField':
      if (typeof defaultValue !== 'string') {
        return { isValid: false, error: 'BooleanField default_value must be a string' };
      }
      // Check if the default value exists in choices
      const boolChoiceValues = field.choices.map((choice) => choice.value);
      if (!boolChoiceValues.includes(defaultValue)) {
        return {
          isValid: false,
          error: `BooleanField default_value "${defaultValue}" not found in choices`,
        };
      }
      break;

    case 'LabelField':
      // LabelField doesn't support default_value
      return { isValid: false, error: 'LabelField does not support default_value' };
  }

  return { isValid: true };
}
