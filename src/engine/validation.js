import { flattenFields } from '../utils/flatten-fields.js';
import { validateFieldValue } from '../utils/field-value-registry.js';

export function validateFields(schema, values, errors) {
  const fields = flattenFields(schema.elements);

  for (const field of fields) {
    const dataName = field.data_name;
    delete errors[dataName]; // ✅ clear previous error

    const value = values[dataName];
    
    const error = validateFieldValue(field, value);
    if (error) {
      errors[dataName] = error;
    }
  }
}
