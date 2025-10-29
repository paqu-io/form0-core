import { flattenFields } from '../utilities/field-helpers.js';
import { validateFieldValue } from '../schema/field-value-registry.js';

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
