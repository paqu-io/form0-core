import { flattenFields } from '../utilities/field-helpers.js';
import { validateFieldSchema, validateDefaultValue } from './field-schema-registry.js';
import { isSupportedFieldType } from '../utilities/field-types.js';
import { validateFieldConditions } from './operators.js';

export function validateSchema(form) {
  const fields = flattenFields(form.elements);
  const seenDataNames = new Set();
  const seenKeys = new Set();
  const duplicateDataNames = new Set();
  const duplicateKeys = new Set();
  const errors = [];

  // Create a map of all fields by key and data_name for condition validation
  const allFields = {};
  fields.forEach((field) => {
    if (field.key) {
      allFields[field.key] = field;
    }
    if (field.data_name) {
      allFields[field.data_name] = field;
    }
  });

  for (const field of fields) {
    if (!isSupportedFieldType(field.type)) {
      errors.push(`Unsupported field type: ${field.type}`);
      continue;
    }

    if (!field.data_name) {
      errors.push(`Missing data_name in field: ${field.label || field.key}`);
      continue;
    }

    if (field.data_name.length > 42) {
      errors.push(`data_name "${field.data_name}" exceeds 42 characters`);
    }

    if (!/^[a-z0-9_]+$/.test(field.data_name)) {
      errors.push(
        `Invalid data_name "${field.data_name}". Only a-z, 0-9 and underscores (_) are allowed.`
      );
    }

    if (seenDataNames.has(field.data_name)) {
      duplicateDataNames.add(field.data_name);
    }
    seenDataNames.add(field.data_name);

    if (!field.key) {
      errors.push(`Missing key for field "${field.data_name}"`);
      continue;
    }

    if (seenKeys.has(field.key)) {
      duplicateKeys.add(field.key);
    }
    seenKeys.add(field.key);

    // Validate default_value for all field types
    if (field.default_value !== undefined && field.default_value !== null) {
      const validation = validateDefaultValue(field, field.default_value);
      if (!validation.isValid) {
        errors.push(`Invalid default_value for ${field.data_name}: ${validation.error}`);
      }
    }

    // Validate field schema using the new registry
    const fieldValidation = validateFieldSchema(field);
    if (!fieldValidation.isValid) {
      errors.push(...fieldValidation.errors);
    }

    // Validate conditions for all field types
    if (field.visible_conditions) {
      const validation = validateFieldConditions(field, field.visible_conditions, allFields);
      if (!validation.isValid) {
        errors.push(...validation.errors);
      }
    }

    if (field.requirement_conditions) {
      const validation = validateFieldConditions(field, field.requirement_conditions, allFields);
      if (!validation.isValid) {
        errors.push(...validation.errors);
      }
    }

    if (field.read_only_conditions) {
      const validation = validateFieldConditions(field, field.read_only_conditions, allFields);
      if (!validation.isValid) {
        errors.push(...validation.errors);
      }
    }
  }

  // Validate top-level status_field and title_field if present
  if (form.status_field) {
    const statusValidation = validateFieldSchema(form.status_field);
    if (!statusValidation.isValid) {
      errors.push(...statusValidation.errors.map((e) => `status_field: ${e}`));
    }
    // Validate default_value if present
    if (form.status_field.default_value !== undefined && form.status_field.default_value !== null) {
      const dv = validateDefaultValue(form.status_field, form.status_field.default_value);
      if (!dv.isValid) {
        errors.push(`status_field default_value: ${dv.error}`);
      }
    }
  }
  if (form.title_field) {
    const titleValidation = validateFieldSchema(form.title_field);
    if (!titleValidation.isValid) {
      errors.push(...titleValidation.errors.map((e) => `title_field: ${e}`));
    }
  }

  // Add duplicate errors to the main errors array
  if (duplicateDataNames.size > 0) {
    errors.push(`Duplicate data_name(s): ${Array.from(duplicateDataNames).join(', ')}`);
  }

  if (duplicateKeys.size > 0) {
    errors.push(`Duplicate key(s): ${Array.from(duplicateKeys).join(', ')}`);
  }

  // Validate events section if present
  if (form.events) {
    if (typeof form.events !== 'object') {
      errors.push('Form events must be an object');
    }

    if (form.events.code && typeof form.events.code !== 'string') {
      errors.push('Form events.code must be a string');
    }
  }

  // Throw all errors at once if any were found
  if (errors.length > 0) {
    const errorMessage =
      errors.length === 1
        ? errors[0]
        : `Validation failed with ${errors.length} errors:\n${errors.map((error, index) => `${index + 1}. ${error}`).join('\n')}`;
    throw new Error(errorMessage);
  }
}
