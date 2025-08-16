import { flattenFields } from '../utilities/field-helpers.js';

const OPERATORS = {
  equal_to: (a, b) => a === b,
  not_equal_to: (a, b) => a !== b,
  greater_than: (a, b) => a > b,
  less_than: (a, b) => a < b,
  greater_or_equal_than: (a, b) => a >= b,
  less_or_equal_than: (a, b) => a <= b,
  contains: (a, b) => Array.isArray(a) && a.includes(b),
  starts_with: (a, b) => typeof a === 'string' && a.startsWith(b),
  is_empty: (a) =>
    a === null || a === undefined || a === '' || (Array.isArray(a) && a.length === 0),
  is_not_empty: (a) =>
    !(a === null || a === undefined || a === '' || (Array.isArray(a) && a.length === 0)),
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

/**
 * Recursively evaluates visibility for both fields and sections in bottom-up order
 * @param {Array} elements - Form elements to evaluate
 * @param {Object} values - Current form values
 * @param {Object} visible - Visibility state object to populate
 * @param {Object} allFields - Map of all fields by key for condition evaluation
 */
function evaluateVisibilityRecursive(elements, values, visible, allFields) {
  elements.forEach((element) => {
    if (element.type === 'Section' || element.type === 'RepeatableSection') {
      // First evaluate children (bottom-up approach)
      if (element.elements && element.elements.length > 0) {
        evaluateVisibilityRecursive(element.elements, values, visible, allFields);

        // Check if any child is visible
        const hasVisibleChild = element.elements.some(
          (child) => visible[child.data_name] !== false
        );

        if (!hasVisibleChild) {
          // All children hidden → force hide section (override explicit settings)
          visible[element.data_name] = false;
        } else {
          // At least one child visible → respect explicit section visibility settings
          if (element.visible_conditions) {
            const isVisible = evaluateConditions(element.visible_conditions, values, allFields);
            visible[element.data_name] = isVisible;
          } else {
            visible[element.data_name] = element.visible === true;
          }
        }
      } else {
        // Empty section fallback (though schema validation should prevent this)
        if (element.visible_conditions) {
          const isVisible = evaluateConditions(element.visible_conditions, values, allFields);
          visible[element.data_name] = isVisible;
        } else {
          visible[element.data_name] = element.visible === true;
        }
      }
    } else {
      // Regular field - existing logic
      if (element.visible_conditions) {
        const isVisible = evaluateConditions(element.visible_conditions, values, allFields);
        visible[element.data_name] = isVisible;
      } else {
        visible[element.data_name] = element.visible === true;
      }
    }
  });
}

export function evaluateVisibility(schema, values, visible) {
  // Build allFields map by key using flattened fields for condition evaluation
  // PERFORMANCE NOTE: For large/static schemas, consider caching/memoizing allFields per schema
  // to avoid rebuilding on every evaluation. See #perf-caching-idea.
  const fields = flattenFields(schema.elements);
  const allFields = {};
  fields.forEach((field) => {
    if (field.key) allFields[field.key] = field;
  });

  // Use recursive approach for single-pass visibility evaluation
  evaluateVisibilityRecursive(schema.elements, values, visible, allFields);
}

export function evaluateRequirement(schema, values, required) {
  const fields = flattenFields(schema.elements);
  // Build allFields map by key
  // PERFORMANCE NOTE: For large/static schemas, consider caching/memoizing allFields per schema
  // to avoid rebuilding on every evaluation. See #perf-caching-idea.
  const allFields = {};
  fields.forEach((field) => {
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
  fields.forEach((field) => {
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
