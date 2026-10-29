import { copyRecordData } from './record-data.js';

const CHOICE_TYPES = new Set(['SingleChoiceField', 'BooleanField', 'MultiChoiceField']);
const PROTECTED_TYPES = new Set([
  'CalculatedField',
  'LabelField',
  'TitleField',
  'Section',
  'RepeatableSection',
  'BuildingPlanSection',
]);
const isObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

const invalid = (field, message) =>
  new TypeError(`Invalid value update for "${field?.data_name || 'unknown field'}": ${message}`);

export function assertWritableField(field) {
  if (!field || PROTECTED_TYPES.has(field.type))
    throw invalid(field, 'the target must be an input field.');
}

/**
 * Copy a writable field's live value, expanding string choice shorthand without changing schema
 * or stored-record formats. Invalid selections remain data; malformed calls throw TypeError.
 * @param {Object} field Schema field definition.
 * @param {*} value Live value or type-appropriate choice shorthand.
 * @returns {*} Defensive live value; immutable native media handles are retained.
 */
export function normalizeFieldValue(field, value) {
  assertWritableField(field);
  try {
    if (!CHOICE_TYPES.has(field.type)) return copyRecordData(value);
    const multiple = field.type === 'MultiChoiceField';
    const key = multiple ? 'choices' : 'choice';
    const opposite = multiple ? 'choice' : 'choices';
    let live;
    if (value == null) return { [key]: [], other: [] };
    if (!multiple && typeof value === 'string') {
      live = { choice: [{ value }], other: [] };
    } else if (multiple && Array.isArray(value)) {
      if (value.some((entry) => typeof entry !== 'string'))
        throw invalid(field, 'multiple-choice shorthand must contain string IDs.');
      live = { choices: value.map((entry) => ({ value: entry })), other: [] };
    } else {
      if (!isObject(value) || Object.hasOwn(value, opposite) || !Array.isArray(value[key]))
        throw invalid(
          field,
          `use ${multiple ? 'an array of string IDs' : 'a string ID'} or a { ${key}, other } object.`
        );
      live = copyRecordData(value);
      if (!Object.hasOwn(live, 'other')) live.other = [];
    }
    if (!Array.isArray(live.other)) throw invalid(field, 'other must be an array.');
    for (const entry of live[key]) {
      if (!isObject(entry) || typeof entry.value !== 'string')
        throw invalid(field, `${key} entries must be objects with a string value.`);
      if (entry.label == null) {
        const defined = field.choices?.find((choice) => choice.value === entry.value);
        entry.label = defined?.label ?? entry.value;
      }
    }
    for (const entry of live.other)
      if (!isObject(entry) || !Object.hasOwn(entry, 'label'))
        throw invalid(field, 'other entries must be objects with a label.');
    return live;
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw invalid(field, error.message);
  }
}

/** Loaded drafts remain inspectable even if their existing field structures are invalid. */
export function normalizeLoadedFieldValue(field, value) {
  if (CHOICE_TYPES.has(field.type)) {
    try {
      return normalizeFieldValue(field, value);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
  }
  return copyRecordData(value);
}

/** Preflight the entire batch before any caller changes live or optimistic state. */
export function prepareValueUpdates(fields, updates, mode = 'edit') {
  if (!isObject(updates)) throw new TypeError('Value updates must be a plain object.');
  const entries = Object.entries(updates);
  if (entries.length && mode === 'readonly')
    throw new TypeError('Cannot set values while the record is readonly.');
  const prepared = {};
  for (const [name, value] of entries) {
    const field = fields.get(name);
    if (!field) throw new TypeError(`Unknown or unowned value-update field "${name}".`);
    Object.defineProperty(prepared, name, {
      value: normalizeFieldValue(field, value),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return prepared;
}
