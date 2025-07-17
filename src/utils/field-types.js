export const FIELD_TYPES = new Set([
  'TextField',
  'NumericField',
  'CalculatedField',
  'SingleChoiceField',
  'MultiChoiceField',
  'DateField',
  'TimeField',
  'Section',
  'BooleanField',
  'LabelField',
  'SignatureField',
  'PhotoField',
  'VideoField',
]);

export function isSupportedFieldType(type) {
  return FIELD_TYPES.has(type);
}
