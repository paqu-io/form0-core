import { OPERATORS as CONDITION_OPERATORS } from '../engine/conditions.js';

const FORM_LINK_ALLOWED_OPERATORS = new Set(Object.keys(CONDITION_OPERATORS));

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

export function validateFormLinkRecordDefaults(field) {
  if (field.record_defaults == null) {
    return { isValid: true };
  }

  if (!Array.isArray(field.record_defaults)) {
    return {
      isValid: false,
      error: `FormLinkField "${field.data_name}" record_defaults must be an array`,
    };
  }

  for (let index = 0; index < field.record_defaults.length; index += 1) {
    const entry = field.record_defaults[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return {
        isValid: false,
        error: `FormLinkField "${field.data_name}" record_defaults[${index}] must be an object`,
      };
    }

    if (!isNonEmptyString(entry.source_field_id)) {
      return {
        isValid: false,
        error: `FormLinkField "${field.data_name}" record_defaults[${index}].source_field_id must be a non-empty string`,
      };
    }

    if (!isNonEmptyString(entry.destination_field_id)) {
      return {
        isValid: false,
        error: `FormLinkField "${field.data_name}" record_defaults[${index}].destination_field_id must be a non-empty string`,
      };
    }
  }

  return { isValid: true };
}

function validateFormLinkConditionNode(field, node, path = 'record_conditions') {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return {
      isValid: false,
      error: `FormLinkField "${field.data_name}" ${path} must be an object`,
    };
  }

  if (node.and !== undefined) {
    if (!Array.isArray(node.and) || node.and.length === 0) {
      return {
        isValid: false,
        error: `FormLinkField "${field.data_name}" ${path}.and must be a non-empty array`,
      };
    }

    for (let idx = 0; idx < node.and.length; idx += 1) {
      const child = node.and[idx];
      const result = validateFormLinkConditionNode(field, child, `${path}.and[${idx}]`);
      if (!result.isValid) {
        return result;
      }
    }

    return { isValid: true };
  }

  if (node.or !== undefined) {
    if (!Array.isArray(node.or) || node.or.length === 0) {
      return {
        isValid: false,
        error: `FormLinkField "${field.data_name}" ${path}.or must be a non-empty array`,
      };
    }

    for (let idx = 0; idx < node.or.length; idx += 1) {
      const child = node.or[idx];
      const result = validateFormLinkConditionNode(field, child, `${path}.or[${idx}]`);
      if (!result.isValid) {
        return result;
      }
    }

    return { isValid: true };
  }

  if (!isNonEmptyString(node.linked_form_field_id)) {
    return {
      isValid: false,
      error: `FormLinkField "${field.data_name}" ${path}.linked_form_field_id must be a non-empty string`,
    };
  }

  if (!isNonEmptyString(node.operator)) {
    return {
      isValid: false,
      error: `FormLinkField "${field.data_name}" ${path}.operator must be a non-empty string`,
    };
  }

  if (!FORM_LINK_ALLOWED_OPERATORS.has(node.operator)) {
    return {
      isValid: false,
      error: `FormLinkField "${field.data_name}" ${path}.operator "${node.operator}" is not supported`,
    };
  }

  return { isValid: true };
}

export function validateFormLinkRecordConditions(field) {
  if (field.record_conditions == null) {
    return { isValid: true };
  }

  const result = validateFormLinkConditionNode(field, field.record_conditions);
  if (!result.isValid) {
    return result;
  }

  return { isValid: true };
}

export const FORM_LINK_ALLOWED_OPERATORS_SET = FORM_LINK_ALLOWED_OPERATORS;
