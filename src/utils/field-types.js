export const FIELD_TYPES = new Set([
    'TextField',
    'NumericField',
    'CalculatedField',
    'ChoiceField',
    'Section'
  ]);
  
export function isSupportedFieldType(type) {
    return FIELD_TYPES.has(type);
}