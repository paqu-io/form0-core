import { flattenFields } from '../utils/flatten-fields.js';

const OPERATORS = {
  equal_to: (a, b) => a === b,
  not_equal_to: (a, b) => a !== b,
  greater_than: (a, b) => a > b,
  less_than: (a, b) => a < b,
  greater_or_equal_than: (a, b) => a >= b,
  less_or_equal_than: (a, b) => a <= b,
  contains: (a, b) => Array.isArray(a) && a.includes(b),
  starts_with: (a, b) => typeof a === 'string' && a.startsWith(b),
  is_empty: (a) => a === null || a === undefined || a === '' || (Array.isArray(a) && a.length === 0),
  is_not_empty: (a) => !(a === null || a === undefined || a === '' || (Array.isArray(a) && a.length === 0)),
};

export function evaluateConditions(conditions, values, allFields) {
  if (Array.isArray(conditions)) {
    return conditions.every((c) => evaluateConditions(c, values, allFields));
  }

  if (conditions.and) {
    return conditions.and.every((c) => evaluateConditions(c, values, allFields));
  }

  if (conditions.or) {
    return conditions.or.some((c) => evaluateConditions(c, values, allFields));
  }

  // Map field_id (key) to data_name for value lookup
  const field = allFields ? allFields[conditions.field_id] : undefined;
  const dataName = field ? field.data_name : undefined;
  const val = dataName ? values[dataName] : undefined;
  // Debug log: show what is being checked
  //console.log('[evaluateConditions] field_id:', conditions.field_id, 'data_name:', dataName, 'value in values:', val, 'expected:', conditions.value, 'operator:', conditions.operator);
  const fn = OPERATORS[conditions.operator];
  return fn ? fn(val, conditions.value) : false;
}

export function evaluateVisibility(schema, values, visible) {
  const fields = flattenFields(schema.elements);
  // Build allFields map by key
  // PERFORMANCE NOTE: For large/static schemas, consider caching/memoizing allFields per schema
  // to avoid rebuilding on every evaluation. See #perf-caching-idea.
  const allFields = {};
  fields.forEach(field => {
    if (field.key) allFields[field.key] = field;
  });
  fields.forEach((field) => {
    if (field.visible_conditions) {
      const isVisible = evaluateConditions(field.visible_conditions, values, allFields);
      visible[field.data_name] = isVisible;
    } else {
      visible[field.data_name] = field.visible === true;
    }
  });
}

export function evaluateRequirement(schema, values, required) {
  const fields = flattenFields(schema.elements);
  // Build allFields map by key
  // PERFORMANCE NOTE: For large/static schemas, consider caching/memoizing allFields per schema
  // to avoid rebuilding on every evaluation. See #perf-caching-idea.
  const allFields = {};
  fields.forEach(field => {
    if (field.key) allFields[field.key] = field;
  });
  fields.forEach((field) => {
    if (field.requirement_conditions) {
      const isRequired = evaluateConditions(field.requirement_conditions, values, allFields);
      required[field.data_name] = isRequired;
    } else {
      required[field.data_name] = field.required === true;
    }
  });
}

export function evaluateReadOnly(schema, values, read_only) {
  const fields = flattenFields(schema.elements);
  // Build allFields map by key
  // PERFORMANCE NOTE: For large/static schemas, consider caching/memoizing allFields per schema
  // to avoid rebuilding on every evaluation. See #perf-caching-idea.
  const allFields = {};
  fields.forEach(field => {
    if (field.key) allFields[field.key] = field;
  });
  fields.forEach((field) => {
    if (field.read_only_conditions) {
      const isReadOnly = evaluateConditions(field.read_only_conditions, values, allFields);
      read_only[field.data_name] = isReadOnly;
    } else {
      read_only[field.data_name] = field.read_only === true;
    }
  });
}

// Export available operators for external use
export { OPERATORS };
