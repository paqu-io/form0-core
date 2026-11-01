/** Distinguish an unfinished Other answer from a malformed choice payload. */
export function validateOtherChoiceLabels(field, other) {
  for (const entry of other) {
    if (!entry || typeof entry !== 'object' || typeof entry.label !== 'string')
      return `${field.data_name}.other must contain objects with 'label' property`;
    if (!entry.label.trim()) return "Please specify an 'Other' value.";
  }
  return null;
}
