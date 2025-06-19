import { runExpression } from '../evaluator.js';
import { flattenFields } from '../utils/flatten-fields.js';

export function evaluateCalculatedFields(schema, values, helpers) {
  const fields = flattenFields(schema.elements);

  fields.forEach(field => {
    if (field.type === 'CalculatedField' && field.calculate) {
      try {
        const context = buildContext(values, helpers);
        values[field.data_name] = runExpression(field.calculate, context);
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