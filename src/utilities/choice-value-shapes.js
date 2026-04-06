const SINGLE_CHOICE_TYPES = new Set(['SingleChoiceField', 'BooleanField']);
const MULTI_CHOICE_TYPES = new Set(['MultiChoiceField']);
const RENDERER_ALIAS_KEYS = ['choice', 'choices', 'other'];

const isRecordObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const cloneJson = (value) => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

const trimString = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isChoicePrimitive = (value) =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

const normalizeChoiceLabel = (value) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return isChoicePrimitive(value) ? value : null;
};

const toFieldType = (field) => trimString(field?.type) ?? trimString(field?.field_type);

const toFieldIdentifier = (field) =>
  trimString(field?.data_name) ??
  trimString(field?.output_key) ??
  trimString(field?.key) ??
  trimString(field?.field_id) ??
  trimString(field?.label) ??
  'choice field';

const getChoiceKind = (field) => {
  const fieldType = toFieldType(field);
  if (SINGLE_CHOICE_TYPES.has(fieldType)) {
    return 'single';
  }

  if (MULTI_CHOICE_TYPES.has(fieldType)) {
    return 'multi';
  }

  return null;
};

const getCanonicalSelectionKey = (field) =>
  getChoiceKind(field) === 'multi' ? 'choices_value' : 'choice_value';

const createChoiceShapeError = (context, field, message) => {
  const prefix = trimString(context) ?? 'record-side choice utilities';
  return new Error(`[form0] ${prefix}: field "${toFieldIdentifier(field)}" ${message}`);
};

const assertCanonicalChoiceShape = (field, rawValue, context) => {
  if (rawValue === null || typeof rawValue === 'undefined') {
    return;
  }

  if (!isRecordObject(rawValue)) {
    throw createChoiceShapeError(
      context,
      field,
      'must be a canonical stored object using *_value arrays'
    );
  }

  const rendererKeys = RENDERER_ALIAS_KEYS.filter((key) =>
    Object.prototype.hasOwnProperty.call(rawValue, key)
  );
  if (rendererKeys.length > 0) {
    throw createChoiceShapeError(
      context,
      field,
      `must not use renderer keys (${rendererKeys.join(', ')})`
    );
  }

  const kind = getChoiceKind(field);
  if (kind === 'single' && Object.prototype.hasOwnProperty.call(rawValue, 'choices_value')) {
    throw createChoiceShapeError(
      context,
      field,
      'must use "choice_value" instead of "choices_value"'
    );
  }

  if (kind === 'multi' && Object.prototype.hasOwnProperty.call(rawValue, 'choice_value')) {
    throw createChoiceShapeError(
      context,
      field,
      'must use "choices_value" instead of "choice_value"'
    );
  }
};

const resolveSchemaChoice = (field, rawValue) => {
  if (!Array.isArray(field?.choices)) {
    return null;
  }

  return (
    field.choices.find(
      (choice) =>
        isRecordObject(choice) &&
        Object.prototype.hasOwnProperty.call(choice, 'value') &&
        choice.value === rawValue
    ) ?? null
  );
};

const normalizeStoredSelectedEntry = (field, entry, context) => {
  if (!isRecordObject(entry)) {
    throw createChoiceShapeError(context, field, 'must store selected entries as objects');
  }

  if (!Object.prototype.hasOwnProperty.call(entry, 'value')) {
    throw createChoiceShapeError(context, field, 'must store selected entries with a "value"');
  }

  const matchedChoice = resolveSchemaChoice(field, entry.value);
  const resolvedLabel = matchedChoice
    ? (normalizeChoiceLabel(matchedChoice.label) ?? entry.value)
    : (normalizeChoiceLabel(entry.label) ?? entry.value);

  return {
    ...entry,
    value: entry.value,
    label: resolvedLabel,
  };
};

const normalizeStoredOtherEntry = (field, entry, context) => {
  if (!isRecordObject(entry)) {
    throw createChoiceShapeError(context, field, 'must store other entries as objects');
  }

  const hasPrimitiveValue = isChoicePrimitive(entry.value);
  const normalizedLabel = normalizeChoiceLabel(entry.label);

  if (!hasPrimitiveValue && normalizedLabel === null) {
    throw createChoiceShapeError(
      context,
      field,
      'must store other entries with a primitive "label" or "value"'
    );
  }

  return {
    ...entry,
    ...(hasPrimitiveValue ? { value: entry.value } : {}),
    label: normalizedLabel ?? entry.value,
  };
};

const normalizeChoiceEntryArray = (field, entries, normalizer, context, keyName) => {
  if (typeof entries === 'undefined') {
    return [];
  }

  if (!Array.isArray(entries)) {
    throw createChoiceShapeError(context, field, `"${keyName}" must be an array`);
  }

  return entries.map((entry) => normalizer(field, entry, context));
};

export function isChoiceFieldLike(field) {
  return getChoiceKind(field) !== null;
}

export function normalizeStoredChoiceValue(field, rawValue, options = {}) {
  const context = options.context;
  const kind = getChoiceKind(field);

  if (!kind || rawValue === null || typeof rawValue === 'undefined') {
    return rawValue;
  }

  assertCanonicalChoiceShape(field, rawValue, context);

  const selectionKey = getCanonicalSelectionKey(field);
  const normalized = {
    ...rawValue,
    [selectionKey]: normalizeChoiceEntryArray(
      field,
      rawValue[selectionKey],
      normalizeStoredSelectedEntry,
      context,
      selectionKey
    ),
    other_value: normalizeChoiceEntryArray(
      field,
      rawValue.other_value,
      normalizeStoredOtherEntry,
      context,
      'other_value'
    ),
  };

  return normalized;
}

export function validateStoredChoiceValue(field, rawValue, options = {}) {
  try {
    const normalized = normalizeStoredChoiceValue(field, rawValue, options);
    const kind = getChoiceKind(field);
    const fieldIdentifier = toFieldIdentifier(field);

    if (normalized && kind === 'single' && toFieldType(field) === 'BooleanField') {
      if (normalized.other_value.length > 0) {
        return `${fieldIdentifier} does not support 'other_value' values`;
      }
    }

    if (normalized && kind !== null && toFieldType(field) !== 'BooleanField') {
      if (field.allow_other !== true && normalized.other_value.length > 0) {
        return `${fieldIdentifier} does not allow 'other_value' values`;
      }
    }

    return null;
  } catch (error) {
    if (error instanceof Error) {
      return error.message.replace(/^\[form0\] [^:]+: /, '');
    }

    return 'stored choice value is invalid';
  }
}

export function toRendererChoiceValue(field, rawValue, options = {}) {
  const kind = getChoiceKind(field);
  if (!kind || rawValue === null || typeof rawValue === 'undefined') {
    return rawValue;
  }

  const normalized = normalizeStoredChoiceValue(field, rawValue, options);
  const selectionKey = getCanonicalSelectionKey(field);

  if (kind === 'multi') {
    return {
      choices: cloneJson(normalized[selectionKey]),
      other: cloneJson(normalized.other_value),
    };
  }

  return {
    choice: cloneJson(normalized[selectionKey]),
    other: cloneJson(normalized.other_value),
  };
}

export function readStoredChoiceSelectionValues(field, rawValue, options = {}) {
  const kind = getChoiceKind(field);
  if (!kind) {
    return [];
  }

  const normalized = normalizeStoredChoiceValue(field, rawValue, options);
  if (normalized === null || typeof normalized === 'undefined') {
    return [];
  }

  const selectionKey = getCanonicalSelectionKey(field);
  const selectedValues = normalized[selectionKey]
    .map((entry) => entry.value)
    .filter((entry) => typeof entry !== 'undefined');
  const otherValues = normalized.other_value
    .map((entry) =>
      isChoicePrimitive(entry.value) ? entry.value : normalizeChoiceLabel(entry.label)
    )
    .filter((entry) => typeof entry !== 'undefined' && entry !== null);

  return [...selectedValues, ...otherValues];
}

export function readStoredChoiceDisplayValues(field, rawValue, options = {}) {
  const kind = getChoiceKind(field);
  if (!kind) {
    return [];
  }

  const normalized = normalizeStoredChoiceValue(field, rawValue, options);
  if (normalized === null || typeof normalized === 'undefined') {
    return [];
  }

  const selectionKey = getCanonicalSelectionKey(field);
  const selectedLabels = normalized[selectionKey]
    .map(
      (entry) =>
        normalizeChoiceLabel(entry.label) ??
        (isChoicePrimitive(entry.value) ? entry.value : undefined)
    )
    .filter((entry) => typeof entry !== 'undefined' && entry !== null);
  const otherLabels = normalized.other_value
    .map(
      (entry) =>
        normalizeChoiceLabel(entry.label) ??
        (isChoicePrimitive(entry.value) ? entry.value : undefined)
    )
    .filter((entry) => typeof entry !== 'undefined' && entry !== null);

  return [...selectedLabels, ...otherLabels];
}
