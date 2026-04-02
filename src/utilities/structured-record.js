import { createFormEngine } from '../engine/form-engine.js';
import {
  buildDatasetDescriptors,
  buildFieldIdentityMap,
  projectDatasetRowValues,
} from './dataset-descriptors.js';

const CONTAINER_TYPES = new Set(['Section', 'BuildingPlanSection']);
const TIMESTAMP_KEYS = [
  'created_at_client',
  'updated_at_client',
  'created_at_server',
  'updated_at_server',
];
const ROOT_DATASET_ID = '__root__';

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

const toNullableString = (value) =>
  value === null || typeof value === 'string' ? value : undefined;

const toOutputKey = (field) => trimString(field?.data_name) ?? trimString(field?.key);

const toDataName = (field, fallback) => trimString(field?.data_name) ?? fallback;

const toAliasList = (field) => {
  const aliases = [];
  const outputKey = toOutputKey(field);
  const dataName = trimString(field?.data_name);
  const key = trimString(field?.key);

  if (outputKey) {
    aliases.push(outputKey);
  }
  if (dataName && !aliases.includes(dataName)) {
    aliases.push(dataName);
  }
  if (key && !aliases.includes(key)) {
    aliases.push(key);
  }

  return aliases;
};

const findFirstAliasEntry = (value, aliases) => {
  if (!isRecordObject(value)) {
    return null;
  }

  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(value, alias)) {
      return {
        key: alias,
        value: value[alias],
      };
    }
  }

  return null;
};

const buildScopeFromElements = (elements) => {
  const scope = {
    valueFields: [],
    repeatables: [],
  };

  if (!Array.isArray(elements)) {
    return scope;
  }

  for (const element of elements) {
    if (!isRecordObject(element) || typeof element.type !== 'string') {
      continue;
    }

    if (CONTAINER_TYPES.has(element.type)) {
      const childScope = buildScopeFromElements(
        Array.isArray(element.elements) ? element.elements : []
      );
      scope.valueFields.push(...childScope.valueFields);
      scope.repeatables.push(...childScope.repeatables);
      continue;
    }

    if (element.type === 'RepeatableSection') {
      const outputKey = toOutputKey(element);
      if (!outputKey) {
        continue;
      }

      scope.repeatables.push({
        aliases: toAliasList(element),
        outputKey,
        repeatableKey: trimString(element.key) ?? trimString(element.data_name) ?? outputKey,
        childScope: buildScopeFromElements(Array.isArray(element.elements) ? element.elements : []),
      });
      continue;
    }

    const outputKey = toOutputKey(element);
    if (!outputKey) {
      continue;
    }

    scope.valueFields.push({
      aliases: toAliasList(element),
      dataName: toDataName(element, outputKey),
      outputKey,
      field: element,
    });
  }

  return scope;
};

const resolveChoiceLabel = (field, rawValue, fallbackLabel) => {
  const normalizedValue = trimString(rawValue);
  if (!normalizedValue) {
    return fallbackLabel ?? null;
  }

  if (Array.isArray(field?.choices)) {
    const matched = field.choices.find(
      (choice) =>
        isRecordObject(choice) &&
        Object.prototype.hasOwnProperty.call(choice, 'value') &&
        choice.value === normalizedValue
    );
    if (matched) {
      return trimString(matched.label) ?? normalizedValue;
    }
  }

  return fallbackLabel ?? normalizedValue;
};

const normalizeChoiceEntry = (field, entry) => {
  if (!isRecordObject(entry)) {
    return entry;
  }

  const rawValue = trimString(entry.value) ?? trimString(entry.label) ?? trimString(entry.id);
  if (!rawValue) {
    return { ...entry };
  }

  return {
    ...entry,
    value: rawValue,
    label: resolveChoiceLabel(field, rawValue, trimString(entry.label)),
  };
};

const normalizeChoiceList = (field, entries) => {
  if (!Array.isArray(entries)) {
    return entries;
  }

  return entries.map((entry) => normalizeChoiceEntry(field, entry));
};

const normalizeChoiceStructuredValue = (field, rawValue) => {
  if (!isRecordObject(rawValue)) {
    return rawValue;
  }

  const normalized = { ...rawValue };

  if (field?.type === 'SingleChoiceField' || field?.type === 'BooleanField') {
    if (Array.isArray(rawValue.choice_value)) {
      normalized.choice_value = normalizeChoiceList(field, rawValue.choice_value);
    }
    if (Array.isArray(rawValue.choice)) {
      normalized.choice = normalizeChoiceList(field, rawValue.choice);
    }
    if (Array.isArray(rawValue.other_value)) {
      normalized.other_value = rawValue.other_value.map((entry) =>
        isRecordObject(entry) ? { ...entry } : entry
      );
    }
    if (Array.isArray(rawValue.other)) {
      normalized.other = rawValue.other.map((entry) =>
        isRecordObject(entry) ? { ...entry } : entry
      );
    }
    return normalized;
  }

  if (field?.type === 'MultiChoiceField') {
    if (Array.isArray(rawValue.choices_value)) {
      normalized.choices_value = normalizeChoiceList(field, rawValue.choices_value);
    }
    if (Array.isArray(rawValue.choices)) {
      normalized.choices = normalizeChoiceList(field, rawValue.choices);
    }
    if (Array.isArray(rawValue.other_value)) {
      normalized.other_value = rawValue.other_value.map((entry) =>
        isRecordObject(entry) ? { ...entry } : entry
      );
    }
    if (Array.isArray(rawValue.other)) {
      normalized.other = rawValue.other.map((entry) =>
        isRecordObject(entry) ? { ...entry } : entry
      );
    }
    return normalized;
  }

  return normalized;
};

const buildFieldReferenceMap = (schema) => {
  const identityMap = buildFieldIdentityMap(schema);
  const references = new Map();

  Object.values(identityMap).forEach((field) => {
    if (!isRecordObject(field)) {
      return;
    }

    [field.field_id, field.output_key, field.key, field.data_name].forEach((ref) => {
      const normalizedRef = trimString(ref);
      if (normalizedRef && !references.has(normalizedRef)) {
        references.set(normalizedRef, field.field_id);
      }
    });
  });

  return references;
};

const toTitlePart = (value) => {
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => toTitlePart(entry))
      .filter((entry) => typeof entry === 'string' && entry.length > 0);
    return parts.length > 0 ? parts.join(', ') : null;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  return null;
};

const computeStructuredRecordTitle = (schema, record) => {
  const formNode = isRecordObject(schema?.form) ? schema.form : null;
  const titleField = isRecordObject(formNode?.title_field) ? formNode.title_field : null;
  const titleElements = Array.isArray(titleField?.elements) ? titleField.elements : [];

  if (!titleField || titleField.enabled === false || titleElements.length === 0) {
    return null;
  }

  const descriptors = buildDatasetDescriptors(schema);
  const rootDescriptor =
    descriptors.find((descriptor) => descriptor.id === ROOT_DATASET_ID) ?? descriptors[0] ?? null;
  if (!rootDescriptor) {
    return null;
  }

  const projected = projectDatasetRowValues(rootDescriptor, record);
  const references = buildFieldReferenceMap(schema);
  const parts = [];

  titleElements.forEach((entry) => {
    const normalizedEntry = trimString(entry);
    if (!normalizedEntry) {
      return;
    }

    const fieldId = references.get(normalizedEntry);
    if (!fieldId) {
      return;
    }

    const part = toTitlePart(projected.displayValues[fieldId]);
    if (part) {
      parts.push(part);
    }
  });

  return parts.length > 0 ? parts.join(', ') : null;
};

const normalizeRecordScope = (record, scope) => {
  if (!isRecordObject(record)) {
    return record;
  }

  const formValues = isRecordObject(record.form_values) ? record.form_values : null;
  if (!formValues) {
    return record;
  }

  scope.valueFields.forEach((field) => {
    const entry = findFirstAliasEntry(formValues, field.aliases);
    if (!entry) {
      return;
    }

    if (
      field.field?.type === 'SingleChoiceField' ||
      field.field?.type === 'BooleanField' ||
      field.field?.type === 'MultiChoiceField'
    ) {
      formValues[entry.key] = normalizeChoiceStructuredValue(field.field, entry.value);
    }
  });

  scope.repeatables.forEach((repeatable) => {
    const entry = findFirstAliasEntry(formValues, repeatable.aliases);
    if (!entry || !Array.isArray(entry.value)) {
      return;
    }

    formValues[entry.key] = entry.value.map((childRecord) => {
      if (!isRecordObject(childRecord)) {
        return childRecord;
      }

      const normalizedChild = cloneJson(childRecord);
      normalizeRecordScope(normalizedChild, repeatable.childScope);
      return normalizedChild;
    });
  });

  return record;
};

const buildSnapshotState = (formValues, scope) => {
  const rawValues = {};
  const repeatable = {};
  const source = isRecordObject(formValues) ? formValues : {};

  scope.valueFields.forEach((field) => {
    const entry = findFirstAliasEntry(source, field.aliases);
    if (!entry) {
      return;
    }

    rawValues[field.dataName] = cloneJson(entry.value);
  });

  scope.repeatables.forEach((repeatableField) => {
    const entry = findFirstAliasEntry(source, repeatableField.aliases);
    if (!entry || !Array.isArray(entry.value)) {
      return;
    }

    const instances = entry.value
      .map((instance) => buildRepeatableInstanceSnapshot(instance, repeatableField.childScope))
      .filter(Boolean);

    if (instances.length > 0) {
      repeatable[repeatableField.repeatableKey] = instances;
    }
  });

  return {
    rawValues,
    repeatable,
  };
};

const buildRepeatableInstanceSnapshot = (record, scope) => {
  if (!isRecordObject(record)) {
    return null;
  }

  const { rawValues, repeatable } = buildSnapshotState(record.form_values, scope);
  const result = {
    values: rawValues,
    repeatable,
  };

  const recordId = trimString(record.id) ?? trimString(record.record_id);
  if (recordId) {
    result.id = recordId;
  }

  const status = toNullableString(record['@status']);
  if (typeof status !== 'undefined') {
    result['@status'] = status;
  }

  const title = toNullableString(record['@title']);
  if (typeof title !== 'undefined') {
    result['@title'] = title;
  }

  if (typeof record.draft === 'boolean') {
    result.draft = record.draft;
  }

  TIMESTAMP_KEYS.forEach((key) => {
    const value = toNullableString(record[key]);
    if (typeof value !== 'undefined') {
      result[key] = value;
    }
  });

  return result;
};

const extractSnapshotTimestamps = (record) => ({
  created_at_client:
    toNullableString(record?.created_at_client) ?? toNullableString(record?.created_at) ?? null,
  updated_at_client:
    toNullableString(record?.updated_at_client) ?? toNullableString(record?.updated_at) ?? null,
  created_at_server: toNullableString(record?.created_at_server) ?? null,
  updated_at_server: toNullableString(record?.updated_at_server) ?? null,
});

export function normalizeStructuredRecord(schema, record, options = {}) {
  const normalized = isRecordObject(record) ? cloneJson(record) : {};
  const mode = trimString(options.mode) ?? 'derived';

  if (mode !== 'derived') {
    return normalized;
  }

  const formNode = isRecordObject(schema?.form) ? schema.form : null;
  const scope = buildScopeFromElements(Array.isArray(formNode?.elements) ? formNode.elements : []);

  normalizeRecordScope(normalized, scope);

  if (formNode) {
    normalized['@title'] = computeStructuredRecordTitle(schema, normalized);
  }

  return normalized;
}

export function buildFormRecordSnapshot(schema, record, options = {}) {
  const normalizedRecord = normalizeStructuredRecord(schema, record, {
    mode: 'derived',
  });
  const formNode = isRecordObject(schema?.form) ? schema.form : null;
  const scope = buildScopeFromElements(Array.isArray(formNode?.elements) ? formNode.elements : []);
  const { rawValues: extractedRawValues, repeatable } = buildSnapshotState(
    normalizedRecord.form_values,
    scope
  );

  const rawValues = cloneJson(extractedRawValues);
  const statusField = isRecordObject(formNode?.status_field) ? formNode.status_field : null;
  const statusFieldName = trimString(statusField?.data_name);
  if (statusFieldName) {
    const status = toNullableString(normalizedRecord['@status']);
    if (typeof status !== 'undefined') {
      rawValues[statusFieldName] = status;
    }
  }

  TIMESTAMP_KEYS.forEach((key) => {
    const value = toNullableString(normalizedRecord[key]);
    if (typeof value !== 'undefined') {
      rawValues[key] = value;
    }
  });

  const mode = trimString(options.mode) ?? 'default';
  const snapshotRawValues =
    mode === 'editor' && formNode
      ? (() => {
          const engine = createFormEngine({
            schema,
            initialValues: rawValues,
          });
          engine.eval();
          return cloneJson(engine.getState().values);
        })()
      : rawValues;

  return {
    raw_values: snapshotRawValues,
    repeatable,
    timestamps: extractSnapshotTimestamps(normalizedRecord),
  };
}
