import { FIELD_TYPES } from '../utilities/field-types.js';

// Define which operators are valid for each field type
const FIELD_TYPE_OPERATORS = {
  // Text-based fields
  TextField: ['equal_to', 'not_equal_to', 'is_empty', 'is_not_empty', 'starts_with', 'contains'],
  CalculatedField: [
    'equal_to',
    'not_equal_to',
    'is_empty',
    'is_not_empty',
    'starts_with',
    'contains',
    'greater_than',
    'less_than',
    'greater_or_equal_than',
    'less_or_equal_than',
  ],

  // Numeric fields
  NumericField: [
    'equal_to',
    'not_equal_to',
    'greater_than',
    'less_than',
    'greater_or_equal_than',
    'less_or_equal_than',
    'is_empty',
    'is_not_empty',
  ],

  // Date/Time fields
  DateField: [
    'equal_to',
    'not_equal_to',
    'greater_than',
    'less_than',
    'greater_or_equal_than',
    'less_or_equal_than',
    'is_empty',
    'is_not_empty',
  ],
  TimeField: [
    'equal_to',
    'not_equal_to',
    'greater_than',
    'less_than',
    'greater_or_equal_than',
    'less_or_equal_than',
    'is_empty',
    'is_not_empty',
  ],

  // Choice fields
  SingleChoiceField: ['equal_to', 'not_equal_to', 'is_empty', 'is_not_empty'],
  MultiChoiceField: ['equal_to', 'not_equal_to', 'contains', 'is_empty', 'is_not_empty'],
  BooleanField: ['equal_to', 'not_equal_to', 'is_empty', 'is_not_empty'],

  // Media fields
  SignatureField: ['is_empty', 'is_not_empty'],
  PhotoField: ['is_empty', 'is_not_empty'],
  VideoField: ['is_empty', 'is_not_empty'],

  // Container fields (no operators)
  Section: [],
  RepeatableSection: [],
  BuildingPlanSection: [],
  LabelField: [],
};

/**
 * Get valid operators for a field type
 * @param {string} fieldType - The field type
 * @param {object} field - The field object (needed for CalculatedField display style)
 * @returns {string[]} Array of valid operators for the field type
 */
export function getValidOperators(fieldType, field = null) {
  // Special handling for CalculatedField based on display style
  if (fieldType === 'CalculatedField' && field && field.display && field.display.style) {
    const displayStyle = field.display.style;
    const styleOperators = {
      text: ['equal_to', 'not_equal_to', 'is_empty', 'is_not_empty', 'starts_with', 'contains'],
      numeric: [
        'equal_to',
        'not_equal_to',
        'greater_than',
        'less_than',
        'greater_or_equal_than',
        'less_or_equal_than',
        'is_empty',
        'is_not_empty',
      ],
      date: [
        'equal_to',
        'not_equal_to',
        'greater_than',
        'less_than',
        'greater_or_equal_than',
        'less_or_equal_than',
        'is_empty',
        'is_not_empty',
      ],
      currency: [
        'equal_to',
        'not_equal_to',
        'greater_than',
        'less_than',
        'greater_or_equal_than',
        'less_or_equal_than',
        'is_empty',
        'is_not_empty',
      ],
    };
    return styleOperators[displayStyle] || [];
  }

  return FIELD_TYPE_OPERATORS[fieldType] || [];
}

/**
 * Check if an operator is valid for a field type
 * @param {string} operator - The operator to check
 * @param {string} fieldType - The field type
 * @param {object} field - The field object (needed for CalculatedField display style)
 * @returns {boolean} True if the operator is valid for the field type
 */
export function isValidOperator(operator, fieldType, field = null) {
  // Special handling for CalculatedField based on display style
  if (fieldType === 'CalculatedField' && field && field.display && field.display.style) {
    const displayStyle = field.display.style;
    const styleOperators = {
      text: ['equal_to', 'not_equal_to', 'is_empty', 'is_not_empty', 'starts_with', 'contains'],
      numeric: [
        'equal_to',
        'not_equal_to',
        'greater_than',
        'less_than',
        'greater_or_equal_than',
        'less_or_equal_than',
        'is_empty',
        'is_not_empty',
      ],
      date: [
        'equal_to',
        'not_equal_to',
        'greater_than',
        'less_than',
        'greater_or_equal_than',
        'less_or_equal_than',
        'is_empty',
        'is_not_empty',
      ],
      currency: [
        'equal_to',
        'not_equal_to',
        'greater_than',
        'less_than',
        'greater_or_equal_than',
        'less_or_equal_than',
        'is_empty',
        'is_not_empty',
      ],
    };
    return styleOperators[displayStyle]?.includes(operator) || false;
  }

  const validOperators = getValidOperators(fieldType);
  return validOperators.includes(operator);
}

/**
 * Validate conditions for a field
 * @param {object} field - The field object
 * @param {object|array} conditions - The conditions to validate
 * @param {object} allFields - All fields in the schema (for looking up target field types)
 * @returns {object} Validation result with isValid boolean and errors array
 */
export function validateFieldConditions(field, conditions, allFields = {}) {
  const errors = [];

  if (!field.type) {
    errors.push(`Field "${field.data_name || field.key}" has no type defined`);
    return { isValid: false, errors };
  }

  if (!FIELD_TYPES.has(field.type)) {
    errors.push(`Field "${field.data_name || field.key}" has unsupported type: ${field.type}`);
    return { isValid: false, errors };
  }

  // Skip validation for container fields
  if (
    field.type === 'Section' ||
    field.type === 'LabelField' ||
    field.type === 'RepeatableSection'
  ) {
    return { isValid: true, errors: [] };
  }

  const validateCondition = (condition) => {
    if (condition.and) {
      condition.and.forEach(validateCondition);
      return;
    }

    if (condition.or) {
      condition.or.forEach(validateCondition);
      return;
    }

    // Use field_id (normalized to key by ensure-keys.js)
    if (condition.operator && condition.field_id) {
      // Find the target field being referenced
      const targetField = allFields[condition.field_id];

      if (!targetField) {
        errors.push(
          `Condition references unknown field "${condition.field_id}" in field "${field.data_name || field.key}"`
        );
        return;
      }

      if (!targetField.type) {
        errors.push(`Target field "${condition.field_id}" has no type defined`);
        return;
      }

      // Check if the operator is valid for the target field's type
      if (!isValidOperator(condition.operator, targetField.type, targetField)) {
        const validOperators = getValidOperators(targetField.type, targetField);
        errors.push(
          `Field "${field.data_name || field.key}" (${field.type}): Operator "${condition.operator}" is not valid for field "${condition.field_id}" (${targetField.type}). ` +
            `Valid operators: ${validOperators.join(', ')}`
        );
      }
    }
  };

  if (Array.isArray(conditions)) {
    conditions.forEach(validateCondition);
  } else {
    validateCondition(conditions);
  }

  return { isValid: errors.length === 0, errors };
}
