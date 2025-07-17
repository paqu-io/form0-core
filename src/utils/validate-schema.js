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

    // Validate default_value for all field types
    if (field.default_value !== undefined && field.default_value !== null) {
      const validation = validateDefaultValue(field, field.default_value);
      if (!validation.isValid) {
        errors.push(`Invalid default_value for ${field.data_name}: ${validation.error}`);
      }
    }

    // Validate description and description_mode
    if ('description' in field && field.description !== null && typeof field.description !== 'string') {
      errors.push(`Field "${field.data_name}" has invalid description: must be null or a string`);
    }
    if ('description_mode' in field) {
      const validModes = [null, 'default', 'subtext'];
      if (!validModes.includes(field.description_mode)) {
        errors.push(`Field "${field.data_name}" has invalid description_mode: must be null, 'default', or 'subtext'`);
      }
      if ((field.description === null || field.description === undefined) && field.description_mode !== null) {
        errors.push(`Field "${field.data_name}" has description_mode set but description is null or missing`);
      }
      if (field.description && (field.description_mode === null || field.description_mode === undefined)) {
        // Allow, but could warn if desired
      }
    }

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

    if (field.type === 'BooleanField') {
      // Validate choices
      if (!Array.isArray(field.choices)) {
        errors.push(`BooleanField "${field.data_name}" must have a 'choices' array`);
      } else {
        const validation = validateChoiceFieldChoices(field.choices);
        if (!validation.isValid) {
          errors.push(`BooleanField "${field.data_name}" validation failed: ${validation.errors.join(', ')}`);
        }
        // Check number of choices
        const thirdOption = field.third_option_enabled === true;
        if (thirdOption && field.choices.length !== 3) {
          errors.push(`BooleanField "${field.data_name}" must have exactly 3 choices when third_option_enabled is true`);
        } else if (!thirdOption && field.choices.length !== 2) {
          errors.push(`BooleanField "${field.data_name}" must have exactly 2 choices when third_option_enabled is false or missing`);
        }
      }
      // Forbid allow_other
      if ('allow_other' in field) {
        errors.push(`BooleanField "${field.data_name}" does not support allow_other`);
      }
      // Display must be 'default'
      if (field.display && field.display !== 'default') {
        errors.push(`BooleanField "${field.data_name}" display must be 'default'`);
      }
      // third_option_enabled must be boolean if present
      if ('third_option_enabled' in field && typeof field.third_option_enabled !== 'boolean') {
        errors.push(`BooleanField "${field.data_name}" third_option_enabled must be a boolean`);
      }
    }

    if (field.type === 'LabelField') {
      // LabelField must have a label
      if (!field.label || typeof field.label !== 'string') {
        errors.push(`LabelField "${field.data_name}" must have a non-empty label`);
      }
      // LabelField should not have certain properties that don't make sense
      if ('choices' in field) {
        errors.push(`LabelField "${field.data_name}" does not support choices`);
      }
      if ('pattern' in field) {
        errors.push(`LabelField "${field.data_name}" does not support pattern`);
      }
      if ('min' in field || 'max' in field) {
        errors.push(`LabelField "${field.data_name}" does not support min/max constraints`);
      }
      if ('format' in field) {
        errors.push(`LabelField "${field.data_name}" does not support format`);
      }
      if ('allow_other' in field) {
        errors.push(`LabelField "${field.data_name}" does not support allow_other`);
      }
      if ('third_option_enabled' in field) {
        errors.push(`LabelField "${field.data_name}" does not support third_option_enabled`);
      }
    }

    if (field.type === 'PhotoField') {
      // Only allow display: 'default'
      if (field.display !== 'default') {
        errors.push(`PhotoField "${field.data_name}" display must be 'default'`);
      }
      // Only allow default_value: null
      if (field.default_value !== null) {
        errors.push(`PhotoField "${field.data_name}" default_value must be null`);
      }
      // min_length and max_length must be null or a number
      if (field.min_length !== null && field.min_length !== undefined && typeof field.min_length !== 'number') {
        errors.push(`PhotoField "${field.data_name}" min_length must be null or a number`);
      }
      if (field.max_length !== null && field.max_length !== undefined && typeof field.max_length !== 'number') {
        errors.push(`PhotoField "${field.data_name}" max_length must be null or a number`);
      }
      // Forbid properties that don't make sense
      if ('choices' in field) {
        errors.push(`PhotoField "${field.data_name}" does not support choices`);
      }
      if ('allow_other' in field) {
        errors.push(`PhotoField "${field.data_name}" does not support allow_other`);
      }
      if ('pattern' in field) {
        errors.push(`PhotoField "${field.data_name}" does not support pattern`);
      }
      if ('format' in field) {
        errors.push(`PhotoField "${field.data_name}" does not support format`);
      }
      if ('third_option_enabled' in field) {
        errors.push(`PhotoField "${field.data_name}" does not support third_option_enabled`);
      }
    }

    if (field.type === 'VideoField') {
      // Only allow display: 'default'
      if (field.display !== 'default') {
        errors.push(`VideoField "${field.data_name}" display must be 'default'`);
      }
      // Only allow default_value: null
      if (field.default_value !== null) {
        errors.push(`VideoField "${field.data_name}" default_value must be null`);
      }
      // min_length and max_length must be null or a number
      if (field.min_length !== null && field.min_length !== undefined && typeof field.min_length !== 'number') {
        errors.push(`VideoField "${field.data_name}" min_length must be null or a number`);
      }
      if (field.max_length !== null && field.max_length !== undefined && typeof field.max_length !== 'number') {
        errors.push(`VideoField "${field.data_name}" max_length must be null or a number`);
      }
      // Forbid properties that don't make sense
      if ('choices' in field) {
        errors.push(`VideoField "${field.data_name}" does not support choices`);
      }
      if ('allow_other' in field) {
        errors.push(`VideoField "${field.data_name}" does not support allow_other`);
      }
      if ('pattern' in field) {
        errors.push(`VideoField "${field.data_name}" does not support pattern`);
      }
      if ('format' in field) {
        errors.push(`VideoField "${field.data_name}" does not support format`);
      }
      if ('third_option_enabled' in field) {
        errors.push(`VideoField "${field.data_name}" does not support third_option_enabled`);
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

function validateDefaultValue(field, defaultValue) {
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
        return { isValid: false, error: 'NumericField with integer format must have integer default_value' };
      }
      // Check min/max constraints
      if (field.min !== undefined && defaultValue < field.min) {
        return { isValid: false, error: `NumericField default_value ${defaultValue} is less than min ${field.min}` };
      }
      if (field.max !== undefined && defaultValue > field.max) {
        return { isValid: false, error: `NumericField default_value ${defaultValue} is greater than max ${field.max}` };
      }
      break;
      
    case 'SingleChoiceField':
      if (typeof defaultValue !== 'string') {
        return { isValid: false, error: 'SingleChoiceField default_value must be a string' };
      }
      // Check if the default value exists in choices
      const choiceValues = field.choices.map(choice => choice.value);
      if (!choiceValues.includes(defaultValue)) {
        return { isValid: false, error: `SingleChoiceField default_value "${defaultValue}" not found in choices` };
      }
      break;
      
    case 'MultiChoiceField':
      if (!Array.isArray(defaultValue)) {
        return { isValid: false, error: 'MultiChoiceField default_value must be an array of strings' };
      }
      // Check if all default values exist in choices
      const multiChoiceValues = field.choices.map(choice => choice.value);
      for (const value of defaultValue) {
        if (typeof value !== 'string') {
          return { isValid: false, error: 'MultiChoiceField default_value array must contain only strings' };
        }
        if (!multiChoiceValues.includes(value)) {
          return { isValid: false, error: `MultiChoiceField default_value "${value}" not found in choices` };
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
      // These field types don't support default_value
      return { isValid: false, error: `${field.type} does not support default_value` };

    case 'BooleanField':
      if (typeof defaultValue !== 'string') {
        return { isValid: false, error: 'BooleanField default_value must be a string' };
      }
      // Check if the default value exists in choices
      const boolChoiceValues = field.choices.map(choice => choice.value);
      if (!boolChoiceValues.includes(defaultValue)) {
        return { isValid: false, error: `BooleanField default_value "${defaultValue}" not found in choices` };
      }
      break;

    case 'LabelField':
      // LabelField doesn't support default_value
      return { isValid: false, error: 'LabelField does not support default_value' };
  }
  
  return { isValid: true };
}

