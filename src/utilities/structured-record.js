import { createFormEngine } from '../engine/form-engine.js';
import { buildDatasetDescriptors, resolveDatasetRowTitle } from './dataset-descriptors.js';
import {
  isChoiceFieldLike,
  normalizeStoredChoiceValue,
  toRendererChoiceValue,
} from './choice-value-shapes.js';

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

const buildScopeFromElements = (elements, descriptorByRepeatable = new Map()) => {
  const scope = {
    valueFields: [],
    repeatables: [],
    datasetDescriptor: null,
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
        Array.isArray(element.elements) ? element.elements : [],
        descriptorByRepeatable
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
        childScope: buildScopeFromElements(
          Array.isArray(element.elements) ? element.elements : [],
          descriptorByRepeatable
        ),
      });
      scope.repeatables[scope.repeatables.length - 1].childScope.datasetDescriptor =
        descriptorByRepeatable.get(trimString(element.key)) ||
        descriptorByRepeatable.get(trimString(element.data_name)) ||
        null;
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

    if (isChoiceFieldLike(field.field)) {
      formValues[entry.key] = normalizeStoredChoiceValue(field.field, entry.value, {
        context: 'normalizeStructuredRecord',
      });
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

  if (scope.datasetDescriptor) {
    record['@title'] = resolveDatasetRowTitle(scope.datasetDescriptor, record);
  }

  return record;
};

const findRepeatableElement = (elements, descriptor) => {
  if (!Array.isArray(elements)) {
    return null;
  }

  for (const element of elements) {
    if (!isRecordObject(element)) {
      continue;
    }
    if (
      element.type === 'RepeatableSection' &&
      [element.key, element.data_name].some(
        (reference) =>
          reference === descriptor.repeatable_field_id ||
          reference === descriptor.repeatable_output_key
      )
    ) {
      return element;
    }
    if (CONTAINER_TYPES.has(element.type) || element.type === 'RepeatableSection') {
      const match = findRepeatableElement(element.elements, descriptor);
      if (match) {
        return match;
      }
    }
  }

  return null;
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

    rawValues[field.dataName] = isChoiceFieldLike(field.field)
      ? toRendererChoiceValue(field.field, entry.value, {
          context: 'buildFormRecordSnapshot',
        })
      : cloneJson(entry.value);
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

/**
 * Normalize a canonical stored record for downstream record-side consumers.
 * Renderer/live aliases are rejected; known choice labels are refreshed from the supplied schema.
 */
export function normalizeStructuredRecord(schema, record, options = {}) {
  const normalized = isRecordObject(record) ? cloneJson(record) : {};
  const mode = trimString(options.mode) ?? 'derived';

  if (mode !== 'derived') {
    return normalized;
  }

  const formNode = isRecordObject(schema?.form) ? schema.form : null;
  const descriptors = buildDatasetDescriptors(schema);
  const descriptorByRepeatable = new Map();
  descriptors.forEach((descriptor) => {
    if (descriptor.kind !== 'repeatable') {
      return;
    }
    [descriptor.repeatable_field_id, descriptor.repeatable_output_key].forEach((reference) => {
      if (reference) {
        descriptorByRepeatable.set(reference, descriptor);
      }
    });
  });

  const requestedDatasetId = trimString(options.datasetId) ?? ROOT_DATASET_ID;
  const datasetDescriptor = descriptors.find((descriptor) => descriptor.id === requestedDatasetId);
  if (!datasetDescriptor) {
    throw new Error(`[form0] normalizeStructuredRecord: unknown dataset "${requestedDatasetId}"`);
  }

  const datasetElement =
    datasetDescriptor.kind === 'repeatable'
      ? findRepeatableElement(formNode?.elements, datasetDescriptor)
      : null;
  const scopeElements =
    datasetDescriptor.kind === 'root'
      ? Array.isArray(formNode?.elements)
        ? formNode.elements
        : []
      : Array.isArray(datasetElement?.elements)
        ? datasetElement.elements
        : [];
  const scope = buildScopeFromElements(scopeElements, descriptorByRepeatable);
  scope.datasetDescriptor = datasetDescriptor;

  normalizeRecordScope(normalized, scope);

  return normalized;
}

/**
 * Build a renderer snapshot from a canonical stored record.
 * Choice fields are converted back to renderer/live shape while record metadata stays top-level.
 */
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
