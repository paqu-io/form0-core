import { FIELD_SPECS } from './field-specs.js';

/**
 * Validates a field value against its specification
 * @param {object} field - The field definition
 * @param {any} value - The value to validate
 * @returns {string|null} - Error message if validation fails, or null if valid
 */
export function validateFieldValue(field, value) {
  const spec = FIELD_SPECS[field.type];
  if (!spec) {
    return `Unsupported field type: ${field.type}`;
  }

  if (spec.valueValidator) {
    return spec.valueValidator(field, value);
  }

  return null;
}

/**
 * Returns the value validator function for a field type
 * @param {string} fieldType - The field type
 * @returns {function|null} - The value validator function or null if not found
 */
export function getFieldValueValidator(fieldType) {
  const spec = FIELD_SPECS[fieldType];
  return spec ? spec.valueValidator : null;
}

/**
 * Validates TextField value
 * @param {object} field - The field definition
 * @param {any} value - The value to validate
 * @returns {string|null} - Error message if validation fails, or null if valid
 */
export function validateTextFieldValue(field, value) {
  if (field.pattern && value !== null && value !== undefined) {
    try {
      const re = new RegExp(field.pattern);
      if (!re.test(value)) {
        return `Invalid format for ${field.data_name}`;
      }
    } catch (e) {
      return `Invalid pattern for ${field.data_name}`;
    }
  }
  return null;
}

/**
 * Validates NumericField value
 * @param {object} field - The field definition
 * @param {any} value - The value to validate
 * @returns {string|null} - Error message if validation fails, or null if valid
 */
export function validateNumericFieldValue(field, value) {
  if (typeof value === 'number') {
    if (field.format === 'integer' && !Number.isInteger(value)) {
      return `${field.data_name} must be an integer`;
    }
    if (field.min !== null && field.min !== undefined && value < field.min) {
      return `Must be at least ${field.min}`;
    }
    if (field.max !== null && field.max !== undefined && value > field.max) {
      return `Must be at most ${field.max}`;
    }
  }
  return null;
}

/**
 * Validates SingleChoiceField value
 * @param {object} field - The field definition
 * @param {any} value - The value to validate
 * @returns {string|null} - Error message if validation fails, or null if valid
 */
export function validateSingleChoiceFieldValue(field, value) {
  if (value !== null && value !== undefined) {
    // Validate the structure of SingleChoiceField value
    if (typeof value !== 'object' || value === null) {
      return `${field.data_name} must be an object with 'choice' and 'other' arrays`;
    }

    if (!Array.isArray(value.choice)) {
      return `${field.data_name}.choice must be an array`;
    }

    if (!Array.isArray(value.other)) {
      return `${field.data_name}.other must be an array`;
    }

    // Validate choice selections
    const validChoiceValues = new Set(field.choices.map((c) => c.value));
    for (const choice of value.choice) {
      if (!choice || typeof choice !== 'object' || !choice.value) {
        return `${field.data_name}.choice must contain objects with 'value' property`;
      }

      if (!validChoiceValues.has(choice.value)) {
        return `${field.data_name}.choice contains invalid value: ${choice.value}`;
      }
    }

    // Validate other selections
    for (const other of value.other) {
      if (!other || typeof other !== 'object' || !other.label) {
        return `${field.data_name}.other must contain objects with 'label' property`;
      }
    }

    // Check if allow_other is false but other array is not empty
    if (!field.allow_other && value.other.length > 0) {
      return `${field.data_name} does not allow 'other' values`;
    }
  }
  return null;
}

/**
 * Validates MultiChoiceField value
 * @param {object} field - The field definition
 * @param {any} value - The value to validate
 * @returns {string|null} - Error message if validation fails, or null if valid
 */
export function validateMultiChoiceFieldValue(field, value) {
  if (value !== null && value !== undefined) {
    // Validate the structure of MultiChoiceField value
    if (typeof value !== 'object' || value === null) {
      return `${field.data_name} must be an object with 'choices' and 'other' arrays`;
    }

    if (!Array.isArray(value.choices)) {
      return `${field.data_name}.choices must be an array`;
    }

    if (!Array.isArray(value.other)) {
      return `${field.data_name}.other must be an array`;
    }

    // Validate choice selections
    const validChoiceValues = new Set(field.choices.map((c) => c.value));
    for (const choice of value.choices) {
      if (!choice || typeof choice !== 'object' || !choice.value) {
        return `${field.data_name}.choices must contain objects with 'value' property`;
      }

      if (!validChoiceValues.has(choice.value)) {
        return `${field.data_name}.choices contains invalid value: ${choice.value}`;
      }
    }

    // Validate other selections
    for (const other of value.other) {
      if (!other || typeof other !== 'object' || !other.label) {
        return `${field.data_name}.other must contain objects with 'label' property`;
      }
    }

    // Check if allow_other is false but other array is not empty
    if (!field.allow_other && value.other.length > 0) {
      return `${field.data_name} does not allow 'other' values`;
    }
  }
  return null;
}

/**
 * Validates BooleanField value
 * @param {object} field - The field definition
 * @param {any} value - The value to validate
 * @returns {string|null} - Error message if validation fails, or null if valid
 */
export function validateBooleanFieldValue(field, value) {
  if (value !== null && value !== undefined) {
    // Validate the structure of BooleanField value
    if (typeof value !== 'object' || value === null) {
      return `${field.data_name} must be an object with 'choice' array`;
    }
    if (!Array.isArray(value.choice)) {
      return `${field.data_name}.choice must be an array`;
    }
    // Forbid 'other' array
    if ('other' in value && Array.isArray(value.other) && value.other.length > 0) {
      return `${field.data_name} does not support 'other' values`;
    }
    // Validate choice selections
    const validChoiceValues = new Set(field.choices.map((c) => c.value));
    for (const choice of value.choice) {
      if (!choice || typeof choice !== 'object' || !choice.value) {
        return `${field.data_name}.choice must contain objects with 'value' property`;
      }
      if (!validChoiceValues.has(choice.value)) {
        return `${field.data_name}.choice contains invalid value: ${choice.value}`;
      }
    }
  }
  return null;
}

/**
 * Validates PhotoField value
 * @param {object} field - The field definition
 * @param {any} value - The value to validate
 * @returns {string|null} - Error message if validation fails, or null if valid
 */
export function validatePhotoFieldValue(field, value) {
  if (value !== null && value !== undefined) {
    if (!Array.isArray(value)) {
      return `${field.data_name} must be an array of photo objects`;
    }
    // Validate each photo object (basic check: must be object, optionally with url or file)
    for (const photo of value) {
      if (typeof photo !== 'object' || photo === null) {
        return `${field.data_name} must contain only photo objects`;
      }
    }
    // Only check min_length/max_length if field has some value
    if (value.length > 0) {
      if (
        field.min_length !== null &&
        field.min_length !== undefined &&
        value.length < field.min_length
      ) {
        return `${field.data_name} must have at least ${field.min_length} photo(s)`;
      }
      if (
        field.max_length !== null &&
        field.max_length !== undefined &&
        value.length > field.max_length
      ) {
        return `${field.data_name} must have at most ${field.max_length} photo(s)`;
      }
    }
  }
  return null;
}

/**
 * Validates VideoField value
 * @param {object} field - The field definition
 * @param {any} value - The value to validate
 * @returns {string|null} - Error message if validation fails, or null if valid
 */
export function validateVideoFieldValue(field, value) {
  if (value !== null && value !== undefined) {
    if (!Array.isArray(value)) {
      return `${field.data_name} must be an array of video objects`;
    }

    let totalDuration = 0;
    for (const video of value) {
      if (typeof video !== 'object' || video === null) {
        return `${field.data_name} must contain only video objects`;
      }
      if (typeof video.duration !== 'number' || video.duration < 0) {
        return `${field.data_name} contains a video with an invalid duration`;
      }
      totalDuration += video.duration;
    }

    // Only check min_length/max_length if there is at least one video with a valid duration
    if (totalDuration > 0) {
      if (
        field.min_length !== null &&
        field.min_length !== undefined &&
        totalDuration < field.min_length * 60
      ) {
        return `${field.data_name} total duration must be at least ${field.min_length} minute(s)`;
      }
      if (
        field.max_length !== null &&
        field.max_length !== undefined &&
        totalDuration > field.max_length * 60
      ) {
        return `${field.data_name} total duration must be at most ${field.max_length} minute(s)`;
      }
    }
  }
  return null;
}

/**
 * Validates FormLinkField value
 * @param {object} field - The field definition
 * @param {any} value - The value to validate
 * @returns {string|null} - Error message if validation fails, or null if valid
 */
export function validateFormLinkFieldValue(field, value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (!Array.isArray(value)) {
    return `${field.data_name} must be an array of linked record references`;
  }

  if (field.allow_multiple_records !== true && value.length > 1) {
    return `${field.data_name} allows only a single linked record`;
  }

  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return `${field.data_name}[${index}] must be an object`;
    }
    if (typeof entry.record_id !== 'string' || entry.record_id.trim() === '') {
      return `${field.data_name}[${index}].record_id must be a non-empty string`;
    }
  }

  return null;
}
