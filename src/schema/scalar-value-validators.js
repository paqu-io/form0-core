import { parseIsoDate } from '../utilities/date-utils.js';

const isEmpty = (value) => value == null || value === '';

export function validateTextFieldValue(field, value) {
  if (isEmpty(value)) return null;
  if (typeof value !== 'string') return `${field.data_name} must be a string`;
  if (field.pattern) {
    try {
      if (!new RegExp(field.pattern).test(value)) return `Invalid format for ${field.data_name}`;
    } catch {
      return `Invalid pattern for ${field.data_name}`;
    }
  }
  return null;
}

export function validateNumericFieldValue(field, value) {
  if (isEmpty(value)) return null;
  if (typeof value !== 'number' || !Number.isFinite(value))
    return `${field.data_name} must be a finite number`;
  if (field.format === 'integer' && !Number.isInteger(value))
    return `${field.data_name} must be an integer`;
  if (field.min != null && value < field.min) return `Must be at least ${field.min}`;
  if (field.max != null && value > field.max) return `Must be at most ${field.max}`;
  return null;
}

export function validateDateFieldValue(field, value) {
  if (isEmpty(value)) return null;
  return parseIsoDate(value) === null ? `${field.data_name} must be a valid YYYY-MM-DD date` : null;
}

export function validateTimeFieldValue(field, value) {
  if (isEmpty(value)) return null;
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)
    ? null
    : `${field.data_name} must be a valid HH:MM or HH:MM:SS time`;
}
