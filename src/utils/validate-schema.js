import { flattenFields } from './flatten-fields.js';
import { isSupportedFieldType } from './field-types.js';
import { validateChoiceFieldChoices } from './choice-field-utils.js';

export function validateSchema(form) {
  const fields = flattenFields(form.elements);
  const seenDataNames = new Set();
  const seenKeys = new Set();
  const duplicateDataNames = new Set();
  const duplicateKeys = new Set();
  const errors = [];

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

    if (field.type === 'Section') {
      if (!Array.isArray(field.elements) || field.elements.length === 0) {
        errors.push(`Section "${field.data_name}" must contain at least one element`);
      }

      const validDisplays = ['inline', 'drilldown'];
      if (field.display && !validDisplays.includes(field.display)) {
        errors.push(
          `Section "${field.data_name}" has invalid display "${field.display}". Allowed: inline, drilldown`
        );
      }
    }

    if (field.type === 'SingleChoiceField') {
      if (!Array.isArray(field.choices)) {
        errors.push(`SingleChoiceField "${field.data_name}" must have a 'choice' array`);
      } else {
        const validation = validateChoiceFieldChoices(field.choices);
        if (!validation.isValid) {
          errors.push(`SingleChoiceField "${field.data_name}" validation failed: ${validation.errors.join(', ')}`);
        }
      }
    }

    if (field.type === 'MultiChoiceField') {
      if (!Array.isArray(field.choices)) {
        errors.push(`MultiChoiceField "${field.data_name}" must have a 'choices' array`);
      } else {
        const validation = validateChoiceFieldChoices(field.choices);
        if (!validation.isValid) {
          errors.push(`MultiChoiceField "${field.data_name}" validation failed: ${validation.errors.join(', ')}`);
        }
      }
    }

    if (field.type === 'NumericField') {
      if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
        errors.push(`NumericField "${field.data_name}" has min > max`);
      }
    }

    if (field.type === 'CalculatedField' && field.display) {
      const allowed = ['text', 'numeric', 'date', 'currency'];
      if (!allowed.includes(field.display.style)) {
        errors.push(`Invalid display.style "${field.display.style}" for ${field.data_name}`);
      }
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
    throw new Error(errors.join('; '));
  }
}

