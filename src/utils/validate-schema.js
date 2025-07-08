import { flattenFields } from './flatten-fields.js';
import { isSupportedFieldType } from './field-types.js';
import { validateChoiceFieldChoices } from './choice-field-utils.js';

export function validateSchema(form) {
  const fields = flattenFields(form.elements);
  const seen = new Set();

  for (const field of fields) {
    if (!isSupportedFieldType(field.type)) {
      throw new Error(`Unsupported field type: ${field.type}`);
    }

    if (!field.data_name) {
      throw new Error(`Missing data_name in field: ${field.label || field.key}`);
    }

    if (field.data_name.length > 42) {
      throw new Error(`data_name "${field.data_name}" exceeds 42 characters`);
    }

    if (!/^[a-z0-9_]+$/.test(field.data_name)) {
      throw new Error(
        `Invalid data_name "${field.data_name}". Only a-z, 0-9 and underscores (_) are allowed.`
      );
    }

    if (seen.has(field.data_name)) {
      throw new Error(`Duplicate data_name: "${field.data_name}"`);
    }
    seen.add(field.data_name);

    if (!field.key) {
      throw new Error(`Missing key for field "${field.data_name}"`);
    }

    if (field.type === 'Section') {
      if (!Array.isArray(field.elements) || field.elements.length === 0) {
        throw new Error(`Section "${field.data_name}" must contain at least one element`);
      }

      const validDisplays = ['inline', 'drilldown'];
      if (field.display && !validDisplays.includes(field.display)) {
        throw new Error(
          `Section "${field.data_name}" has invalid display "${field.display}". Allowed: inline, drilldown`
        );
      }
    }

    if (field.type === 'SingleChoiceField') {
      if (!Array.isArray(field.choices)) {
        throw new Error(`SingleChoiceField "${field.data_name}" must have a 'choice' array`);
      }
      
      const validation = validateChoiceFieldChoices(field.choices);
      if (!validation.isValid) {
        throw new Error(`SingleChoiceField "${field.data_name}" validation failed: ${validation.errors.join(', ')}`);
      }
    }

    if (field.type === 'MultiChoiceField') {
      if (!Array.isArray(field.choices)) {
        throw new Error(`MultiChoiceField "${field.data_name}" must have a 'choices' array`);
      }
      
      const validation = validateChoiceFieldChoices(field.choices);
      if (!validation.isValid) {
        throw new Error(`MultiChoiceField "${field.data_name}" validation failed: ${validation.errors.join(', ')}`);
      }
    }

    if (field.type === 'NumericField') {
      if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
        throw new Error(`NumericField "${field.data_name}" has min > max`);
      }
    }

    if (field.type === 'CalculatedField' && field.display) {
      const allowed = ['text', 'numeric', 'date', 'currency'];
      if (!allowed.includes(field.display.style)) {
        throw new Error(`Invalid display.style "${field.display.style}" for ${field.data_name}`);
      }
    }
  }
  
  // Validate events section if present
  if (form.events) {
    if (typeof form.events !== 'object') {
      throw new Error('Form events must be an object');
    }
    
    if (form.events.code && typeof form.events.code !== 'string') {
      throw new Error('Form events.code must be a string');
    }
  }
}
