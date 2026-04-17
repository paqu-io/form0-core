import { flattenFields } from './field-helpers.js';
import {
  readStoredChoiceDisplayValues,
  readStoredChoiceSelectionValues,
} from './choice-value-shapes.js';

const ROOT_DATASET_ID = '__root__';
const CONTAINER_TYPES = new Set(['Section', 'BuildingPlanSection']);

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const toTrimmedString = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toFiniteNumberOrNull = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const trimmed = toTrimmedString(value);
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const toBooleanOrDefault = (value, fallback = false) =>
  typeof value === 'boolean' ? value : fallback;

const toSchemaFormNode = (schema) => {
  if (!isRecord(schema)) {
    return null;
  }

  if (isRecord(schema.form)) {
    return schema.form;
  }

  if (Array.isArray(schema.elements)) {
    return schema;
  }

  return null;
};

const uniqueAliases = (...values) => {
  const aliases = [];
  for (const value of values) {
    const normalized = toTrimmedString(value);
    if (!normalized || aliases.includes(normalized)) {
      continue;
    }
    aliases.push(normalized);
  }
  return aliases;
};

const toFieldId = (field) => toTrimmedString(field?.key) ?? toTrimmedString(field?.data_name);

const toOutputKey = (field) => toTrimmedString(field?.data_name) ?? toTrimmedString(field?.key);

const toFieldLabel = (field) =>
  toTrimmedString(field?.label) ??
  toTrimmedString(field?.data_name) ??
  toTrimmedString(field?.key) ??
  'Field';

const toRepeatableLabel = (field) =>
  toTrimmedString(field?.label) ??
  toTrimmedString(field?.data_name) ??
  toTrimmedString(field?.key) ??
  'Repeatable section';

const normalizeCalculatedDisplayStyle = (value) => {
  const normalized = toTrimmedString(value);
  if (!normalized) {
    return null;
  }

  switch (normalized.toLowerCase()) {
    case 'number':
      return 'numeric';
    case 'datetime':
      return 'date';
    default:
      return normalized.toLowerCase();
  }
};

const getCalculatedDisplayStyle = (field) => {
  if (!isRecord(field)) {
    return null;
  }

  const directStyle =
    normalizeCalculatedDisplayStyle(field.display_mode) ??
    normalizeCalculatedDisplayStyle(field.display_style);
  if (directStyle) {
    return directStyle;
  }

  const display = field.display;
  if (typeof display === 'string') {
    return normalizeCalculatedDisplayStyle(display);
  }

  if (isRecord(display)) {
    return (
      normalizeCalculatedDisplayStyle(display.style) ??
      normalizeCalculatedDisplayStyle(display.type)
    );
  }

  return null;
};

const QUERY_SEMANTICS_BY_FIELD_TYPE = {
  TextField: {
    query_kind: 'scalar',
    display_kind: 'text',
    sortable: true,
    filterable: true,
    default_operator: 'contains',
    allowed_operators: [
      'contains',
      'not_contains',
      'eq',
      'neq',
      'in',
      'not_in',
      'starts_with',
      'ends_with',
      'is_blank',
      'is_not_blank',
    ],
  },
  NumericField: {
    query_kind: 'scalar',
    display_kind: 'number',
    sortable: true,
    filterable: true,
    default_operator: 'between',
    allowed_operators: [
      'between',
      'gte',
      'lte',
      'eq',
      'neq',
      'gt',
      'lt',
      'in',
      'not_in',
      'is_blank',
      'is_not_blank',
    ],
  },
  DateField: {
    query_kind: 'scalar',
    display_kind: 'date',
    sortable: true,
    filterable: true,
    default_operator: 'between',
    allowed_operators: [
      'between',
      'gte',
      'lte',
      'eq',
      'neq',
      'gt',
      'lt',
      'in',
      'not_in',
      'is_blank',
      'is_not_blank',
    ],
  },
  TimeField: {
    query_kind: 'scalar',
    display_kind: 'time',
    sortable: true,
    filterable: true,
    default_operator: 'between',
    allowed_operators: [
      'between',
      'gte',
      'lte',
      'eq',
      'neq',
      'gt',
      'lt',
      'in',
      'not_in',
      'is_blank',
      'is_not_blank',
    ],
  },
  SingleChoiceField: {
    query_kind: 'scalar',
    display_kind: 'enum',
    sortable: true,
    filterable: true,
    default_operator: 'in',
    allowed_operators: ['in', 'eq', 'neq', 'not_in', 'is_blank', 'is_not_blank'],
  },
  BooleanField: {
    query_kind: 'scalar',
    display_kind: 'enum',
    sortable: true,
    filterable: true,
    default_operator: 'in',
    allowed_operators: ['in', 'eq', 'neq', 'not_in', 'is_blank', 'is_not_blank'],
  },
  MultiChoiceField: {
    query_kind: 'terms',
    display_kind: 'enum_multi',
    sortable: false,
    filterable: true,
    default_operator: 'has_any',
    allowed_operators: ['has_any', 'has_all', 'has_none', 'is_blank', 'is_not_blank'],
  },
};

const DISPLAY_ONLY_SEMANTICS = {
  query_kind: 'display_only',
  display_kind: 'json',
  sortable: false,
  filterable: false,
  default_operator: null,
  allowed_operators: [],
};

const getCalculatedFieldSemantics = (field) => {
  const style = getCalculatedDisplayStyle(field);

  if (style === 'numeric' || style === 'currency') {
    return {
      query_kind: 'scalar',
      display_kind: 'number',
      sortable: true,
      filterable: true,
      default_operator: 'between',
      allowed_operators: [
        'between',
        'gte',
        'lte',
        'eq',
        'neq',
        'gt',
        'lt',
        'in',
        'not_in',
        'is_blank',
        'is_not_blank',
      ],
    };
  }

  if (style === 'date') {
    return {
      query_kind: 'scalar',
      display_kind: 'date',
      sortable: true,
      filterable: true,
      default_operator: 'between',
      allowed_operators: [
        'between',
        'gte',
        'lte',
        'eq',
        'neq',
        'gt',
        'lt',
        'in',
        'not_in',
        'is_blank',
        'is_not_blank',
      ],
    };
  }

  if (style === 'time') {
    return {
      query_kind: 'scalar',
      display_kind: 'time',
      sortable: true,
      filterable: true,
      default_operator: 'between',
      allowed_operators: [
        'between',
        'gte',
        'lte',
        'eq',
        'neq',
        'gt',
        'lt',
        'in',
        'not_in',
        'is_blank',
        'is_not_blank',
      ],
    };
  }

  return {
    query_kind: 'scalar',
    display_kind: 'text',
    sortable: true,
    filterable: true,
    default_operator: 'contains',
    allowed_operators: [
      'contains',
      'not_contains',
      'eq',
      'neq',
      'in',
      'not_in',
      'starts_with',
      'ends_with',
      'is_blank',
      'is_not_blank',
    ],
  };
};

export function getFieldQuerySemantics(field) {
  if (!isRecord(field)) {
    return { ...DISPLAY_ONLY_SEMANTICS };
  }

  if (field.type === 'CalculatedField') {
    return getCalculatedFieldSemantics(field);
  }

  const semantics = QUERY_SEMANTICS_BY_FIELD_TYPE[field.type];
  if (!semantics) {
    return { ...DISPLAY_ONLY_SEMANTICS };
  }

  return { ...semantics };
}

const toSingleChoiceLabel = (field, rawValue) => {
  const labels = readStoredChoiceDisplayValues(field, rawValue, {
    context: 'projectDatasetRowValues',
  });
  if (labels.length === 0) {
    return undefined;
  }

  return labels.length === 1 ? labels[0] : labels;
};

const toMultiChoiceLabels = (field, rawValue) => {
  const labels = readStoredChoiceDisplayValues(field, rawValue, {
    context: 'projectDatasetRowValues',
  });
  if (labels.length === 0) {
    return undefined;
  }

  return labels;
};

const toDisplayValue = (field, rawValue) => {
  if (typeof rawValue === 'undefined') {
    return undefined;
  }

  if (field?.field_type === 'SingleChoiceField' || field?.field_type === 'BooleanField') {
    return toSingleChoiceLabel(field, rawValue);
  }

  if (field?.field_type === 'MultiChoiceField') {
    return toMultiChoiceLabels(field, rawValue);
  }

  return rawValue;
};

const buildDatasetFieldDescriptor = (field, dataset) => {
  const fieldId = toFieldId(field);
  const outputKey = toOutputKey(field);
  if (!fieldId || !outputKey) {
    return null;
  }

  const semantics = getFieldQuerySemantics(field);
  return {
    dataset_id: dataset.id,
    dataset_path: [...dataset.dataset_path],
    field_id: fieldId,
    output_key: outputKey,
    key: toTrimmedString(field.key),
    data_name: toTrimmedString(field.data_name),
    label: toFieldLabel(field),
    field_type: toTrimmedString(field.type) ?? 'UnknownField',
    choices: Array.isArray(field.choices)
      ? field.choices.filter((choice) => isRecord(choice)).map((choice) => ({ ...choice }))
      : undefined,
    aliases: uniqueAliases(outputKey, field.data_name, field.key, fieldId),
    repeatable_depth: dataset.dataset_path.length,
    ...semantics,
  };
};

const collectFieldsForDataset = (elements, dataset) => {
  if (!Array.isArray(elements)) {
    return;
  }

  elements.forEach((element) => {
    if (!isRecord(element) || typeof element.type !== 'string') {
      return;
    }

    if (CONTAINER_TYPES.has(element.type)) {
      collectFieldsForDataset(element.elements, dataset);
      return;
    }

    if (element.type === 'RepeatableSection') {
      return;
    }

    const descriptor = buildDatasetFieldDescriptor(element, dataset);
    if (descriptor) {
      dataset.fields.push(descriptor);
    }
  });
};

const collectRepeatableDatasets = (elements, context, datasets) => {
  if (!Array.isArray(elements)) {
    return;
  }

  elements.forEach((element) => {
    if (!isRecord(element) || typeof element.type !== 'string') {
      return;
    }

    if (CONTAINER_TYPES.has(element.type)) {
      collectRepeatableDatasets(element.elements, context, datasets);
      return;
    }

    if (element.type !== 'RepeatableSection') {
      return;
    }

    const repeatableFieldId = toFieldId(element);
    const repeatableOutputKey = toOutputKey(element);
    if (!repeatableFieldId || !repeatableOutputKey) {
      return;
    }

    const datasetPath = [...context.dataset_path, repeatableFieldId];
    const descriptor = {
      id: datasetPath.join('.'),
      kind: 'repeatable',
      label: [...context.dataset_labels, toRepeatableLabel(element)].join(' / '),
      dataset_path: datasetPath,
      dataset_labels: [...context.dataset_labels, toRepeatableLabel(element)],
      repeatable_output_path: [...context.repeatable_output_path, repeatableOutputKey],
      parent_dataset_id: context.parent_dataset_id,
      repeatable_field_id: repeatableFieldId,
      repeatable_output_key: repeatableOutputKey,
      root_dataset_id: ROOT_DATASET_ID,
      location_enabled: toBooleanOrDefault(element.location_enabled),
      location_required: toBooleanOrDefault(element.location_required),
      fields: [],
    };

    collectFieldsForDataset(element.elements, descriptor);
    datasets.push(descriptor);

    collectRepeatableDatasets(
      element.elements,
      {
        dataset_path: descriptor.dataset_path,
        dataset_labels: descriptor.dataset_labels,
        repeatable_output_path: descriptor.repeatable_output_path,
        parent_dataset_id: descriptor.id,
      },
      datasets
    );
  });
};

export function buildDatasetDescriptors(schema) {
  const formNode = toSchemaFormNode(schema);
  if (!formNode) {
    return [];
  }

  const rootDataset = {
    id: ROOT_DATASET_ID,
    kind: 'root',
    label: toTrimmedString(formNode.name) ?? 'Root form',
    dataset_path: [],
    dataset_labels: [],
    repeatable_output_path: [],
    parent_dataset_id: null,
    repeatable_field_id: null,
    repeatable_output_key: null,
    root_dataset_id: ROOT_DATASET_ID,
    location_enabled: toBooleanOrDefault(formNode.location_enabled),
    location_required: toBooleanOrDefault(formNode.location_required),
    fields: [],
  };

  collectFieldsForDataset(formNode.elements, rootDataset);

  const datasets = [rootDataset];
  collectRepeatableDatasets(
    formNode.elements,
    {
      dataset_path: [],
      dataset_labels: [],
      repeatable_output_path: [],
      parent_dataset_id: ROOT_DATASET_ID,
    },
    datasets
  );

  return datasets;
}

const readFirstAliasValue = (value, aliases) => {
  if (!isRecord(value)) {
    return undefined;
  }

  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(value, alias)) {
      return value[alias];
    }
  }

  return undefined;
};

const normalizeScalarValue = (field, value) => {
  if (field?.field_type === 'SingleChoiceField' || field?.field_type === 'BooleanField') {
    return readStoredChoiceSelectionValues(field, value, {
      context: 'projectDatasetRowValues',
    })[0];
  }

  if (Array.isArray(value)) {
    return undefined;
  }

  if (field?.display_kind === 'number') {
    const parsedNumber = toFiniteNumberOrNull(value);
    if (parsedNumber !== null) {
      return parsedNumber;
    }
  }

  return value;
};

const normalizeTermValues = (field, value) => {
  if (field?.field_type === 'MultiChoiceField') {
    return readStoredChoiceSelectionValues(field, value, {
      context: 'projectDatasetRowValues',
    });
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (entry) => typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean'
  );
};

/**
 * Project a canonical stored row into dataset display/scalar/term values.
 * Choice fields must already use the stored `*_value` record shape.
 */
export function projectDatasetRowValues(descriptor, rowValues) {
  const sourceRecord = isRecord(rowValues) ? rowValues : {};
  const source =
    isRecord(sourceRecord.form_values) && !Array.isArray(sourceRecord.form_values)
      ? sourceRecord.form_values
      : sourceRecord;
  const datasetFields = Array.isArray(descriptor?.fields) ? descriptor.fields : [];

  const displayValues = {};
  const scalarValues = {};
  const termValues = {};

  datasetFields.forEach((field) => {
    const rawValue = readFirstAliasValue(source, field.aliases ?? []);
    if (typeof rawValue === 'undefined') {
      return;
    }

    const displayValue = toDisplayValue(field, rawValue);
    if (typeof displayValue !== 'undefined') {
      displayValues[field.field_id] = displayValue;
    }

    if (field.query_kind === 'scalar') {
      const scalarValue = normalizeScalarValue(field, rawValue);
      if (typeof scalarValue !== 'undefined') {
        scalarValues[field.field_id] = scalarValue;
      }
      return;
    }

    if (field.query_kind === 'terms') {
      const terms = normalizeTermValues(field, rawValue);
      if (terms.length > 0) {
        termValues[field.field_id] = terms;
      }
    }
  });

  return {
    displayValues,
    scalarValues,
    termValues,
  };
}

export function resolveDatasetDescriptorById(schema, datasetId) {
  return buildDatasetDescriptors(schema).find((dataset) => dataset.id === datasetId) ?? null;
}

export function buildFieldIdentityMap(schema) {
  const formNode = toSchemaFormNode(schema);
  if (!formNode) {
    return {};
  }

  const fields = flattenFields(formNode.elements);
  const map = {};
  fields.forEach((field) => {
    if (!isRecord(field)) {
      return;
    }

    const fieldId = toFieldId(field);
    const outputKey = toOutputKey(field);
    if (!fieldId || !outputKey) {
      return;
    }

    map[fieldId] = {
      field_id: fieldId,
      output_key: outputKey,
      key: toTrimmedString(field.key),
      data_name: toTrimmedString(field.data_name),
      label: toFieldLabel(field),
      field_type: toTrimmedString(field.type) ?? 'UnknownField',
    };
  });

  return map;
}
