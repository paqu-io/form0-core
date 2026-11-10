const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const hasChoice = (entries) =>
  Array.isArray(entries) &&
  entries.some(
    (entry) => entry && ((entry.value != null && entry.value !== '') || hasText(entry.label))
  );
const hasOther = (entries) =>
  Array.isArray(entries) &&
  entries.some((entry) =>
    typeof entry === 'string'
      ? hasText(entry)
      : entry && (hasText(entry.label) || (entry.value != null && entry.value !== ''))
  );

/** Type-aware input emptiness shared with submission participation; zero/false are values. */
export function isFieldValueEmpty(field, value) {
  if (!field || value == null) return true;
  switch (field.type) {
    case 'TextField':
    case 'CalculatedField':
    case 'DateField':
    case 'TimeField':
    case 'TitleField':
    case 'StatusField':
      return typeof value === 'string' && !value.trim();
    case 'NumericField':
      return typeof value === 'number' ? false : typeof value === 'string' ? !value.trim() : true;
    case 'SingleChoiceField':
    case 'BooleanField':
      return !hasChoice(value.choice) && !hasOther(value.other);
    case 'MultiChoiceField':
      return !hasChoice(value.choices) && !hasOther(value.other);
    case 'PhotoField':
    case 'VideoField':
      return !Array.isArray(value) || value.length === 0;
    case 'SignatureField':
      return typeof value === 'string'
        ? !value.trim()
        : !(hasText(value?.data) || hasText(value?.url));
    default:
      return Array.isArray(value)
        ? value.length === 0
        : typeof value === 'object'
          ? Object.keys(value).length === 0
          : false;
  }
}
