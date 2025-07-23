import { FIELD_SPECS } from './field-specs.js';

export const FIELD_TYPES = new Set(Object.keys(FIELD_SPECS));

export function isSupportedFieldType(type) {
  return FIELD_SPECS.hasOwnProperty(type);
}
