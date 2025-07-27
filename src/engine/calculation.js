import { runExpression } from './evaluator.js';
import { flattenFields } from '../utilities/field-helpers.js';

export function evaluateCalculatedFields(schema, values, helpers, securityConfig) {
  const fields = flattenFields(schema.elements);

  fields.forEach((field) => {
    if (field.type === 'CalculatedField' && field.calculate) {
      try {
        const context = buildContext(values, helpers);
        values[field.data_name] = runExpression(field.calculate, context, securityConfig);
      } catch (e) {
        console.warn(`Calculation failed for ${field.data_name}:`, e.message);
      }
    }
  });
}

function buildContext(values, helpers) {
  const ctx = {};
  for (const key in values) {
    ctx[`$${key}`] = values[key];
  }
  return { ...ctx, ...helpers };
}
