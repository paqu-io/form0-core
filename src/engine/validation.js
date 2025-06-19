import { flattenFields } from '../utils/flatten-fields.js';

export function validateFields(schema, values, errors) {
  const fields = flattenFields(schema.elements);

  for (const field of fields) {
    const dataName = field.data_name;
    delete errors[dataName]; // ✅ clear previous error

    const value = values[dataName];
    if (field.type === 'TextField' && field.pattern) {
      const re = new RegExp(field.pattern);
      if (!re.test(value)) {
        errors[dataName] = `Invalid format for ${field.data_name}`;
      }
    }
    if (field.type === 'NumericField') {
      if (typeof value === 'number') {
        if (field.format === 'integer' && !Number.isInteger(value)) {
          errors[field.data_name] = `${field.data_name} must be an integer`;
        }
        if (field.min !== undefined && value < field.min) {
          errors[field.data_name] = `Must be at least ${field.min}`;
        }
        if (field.max !== undefined && value > field.max) {
          errors[field.data_name] = `Must be at most ${field.max}`;
        }
      }
    }    
  }
}