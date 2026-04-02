import { flattenFields } from './field-helpers.js';

const ROOT_DATASET_ID = '__root__';
const CONTAINER_TYPES = new Set(['Section', 'BuildingPlanSection']);

const isRecord = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

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

const toFieldId = (field) =>
  toTrimmedString(field?.key) ?? toTrimmedString(field?.data_name);

const toOutputKey = (field) =>
  toTrimmedString(field?.data_name) ?? toTrimmedString(field?.key);

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

const getCalculatedDisplayStyle = (field) => {
  if (!isRecord(field)) {
    return null;
  }

  const display = field.display;
  if (typeof display === 'string') {
    return toTrimmedString(display);
  }

  if (isRecord(display)) {
    return toTrimmedString(display.style);
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
    display_kind: 'boolean',
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

const toChoiceValueList = (field) => {
  if (!Array.isArray(field?.choices)) {
    return [];
  }

  return field.choices.filter((choice) => isRecord(choice));
};

const isChoicePrimitive = (value) =>
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean';

const normalizeChoiceEntryValue = (entry) => {
  if (isChoicePrimitive(entry)) {
    return entry;
  }

  if (!isRecord(entry)) {
    return undefined;
  }

  if (isChoicePrimitive(entry.value)) {
    return entry.value;
  }

  if (isChoicePrimitive(entry.label)) {
    return entry.label;
  }

  return undefined;
};

const normalizeChoiceEntryDisplayValue = (entry) => {
  if (isChoicePrimitive(entry)) {
    return entry;
  }

  if (!isRecord(entry)) {
    return undefined;
  }

  if (isChoicePrimitive(entry.label)) {
    return entry.label;
  }

  if (isChoicePrimitive(entry.value)) {
    return entry.value;
  }

  return undefined;
};

const normalizeChoiceEntryLabel = (field, entry) => {
  const normalizedValue = normalizeChoiceEntryValue(entry);
  if (typeof normalizedValue === 'undefined') {
    return undefined;
  }

  const matched = toChoiceValueList(field).find(
    (choice) =>
      Object.prototype.hasOwnProperty.call(choice, 'value') &&
      choice.value === normalizedValue,
  );
  if (matched) {
    return toTrimmedString(matched.label) ?? normalizedValue;
  }

  if (isRecord(entry) && isChoicePrimitive(entry.label)) {
    return entry.label;
  }

  return normalizedValue;
};

const toSingleChoiceSelectionValues = (rawValue) => {
  if (isRecord(rawValue)) {
    const choiceValues = Array.isArray(rawValue.choice)
      ? rawValue.choice
          .map((entry) => normalizeChoiceEntryValue(entry))
          .filter((entry) => typeof entry !== 'undefined')
      : [];
    const otherValues = Array.isArray(rawValue.other)
      ? rawValue.other
          .map((entry) => normalizeChoiceEntryValue(entry))
          .filter((entry) => typeof entry !== 'undefined')
      : [];

    return [...choiceValues, ...otherValues];
  }

  const normalized = normalizeChoiceEntryValue(rawValue);
  return typeof normalized === 'undefined' ? [] : [normalized];
};

const toSingleChoiceDisplayValues = (field, rawValue) => {
  if (isRecord(rawValue)) {
    const choiceLabels = Array.isArray(rawValue.choice)
      ? rawValue.choice
          .map((entry) => normalizeChoiceEntryLabel(field, entry))
          .filter((entry) => typeof entry !== 'undefined')
      : [];
    const otherLabels = Array.isArray(rawValue.other)
      ? rawValue.other
          .map((entry) => normalizeChoiceEntryDisplayValue(entry))
          .filter((entry) => typeof entry !== 'undefined')
      : [];

    return [...choiceLabels, ...otherLabels];
  }

  const normalized = normalizeChoiceEntryLabel(field, rawValue);
  return typeof normalized === 'undefined' ? [] : [normalized];
};

const toMultiChoiceSelectionValues = (rawValue) => {
  if (isRecord(rawValue)) {
    const selectedValues = Array.isArray(rawValue.choices)
      ? rawValue.choices
          .map((entry) => normalizeChoiceEntryValue(entry))
          .filter((entry) => typeof entry !== 'undefined')
      : [];
    const otherValues = Array.isArray(rawValue.other)
      ? rawValue.other
          .map((entry) => normalizeChoiceEntryValue(entry))
          .filter((entry) => typeof entry !== 'undefined')
      : [];

    return [...selectedValues, ...otherValues];
  }

  if (Array.isArray(rawValue)) {
    return rawValue
      .map((entry) => normalizeChoiceEntryValue(entry))
      .filter((entry) => typeof entry !== 'undefined');
  }

  return [];
};

const toMultiChoiceDisplayValues = (field, rawValue) => {
  if (isRecord(rawValue)) {
    const selectedLabels = Array.isArray(rawValue.choices)
      ? rawValue.choices
          .map((entry) => normalizeChoiceEntryLabel(field, entry))
          .filter((entry) => typeof entry !== 'undefined')
      : [];
    const otherLabels = Array.isArray(rawValue.other)
      ? rawValue.other
          .map((entry) => normalizeChoiceEntryDisplayValue(entry))
          .filter((entry) => typeof entry !== 'undefined')
      : [];

    return [...selectedLabels, ...otherLabels];
  }

  if (Array.isArray(rawValue)) {
    return rawValue
      .map((entry) => normalizeChoiceEntryLabel(field, entry))
      .filter((entry) => typeof entry !== 'undefined');
  }

  return [];
};

const toSingleChoiceLabel = (field, rawValue) => {
  const labels = toSingleChoiceDisplayValues(field, rawValue);
  if (labels.length === 0) {
    return rawValue;
  }

  return labels.length === 1 ? labels[0] : labels;
};

const toMultiChoiceLabels = (field, rawValue) => {
  const labels = toMultiChoiceDisplayValues(field, rawValue);
  if (labels.length === 0) {
    return rawValue;
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
      datasets,
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
    datasets,
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
  if (
    field?.field_type === 'SingleChoiceField' ||
    field?.field_type === 'BooleanField'
  ) {
    return toSingleChoiceSelectionValues(value)[0];
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
    return toMultiChoiceSelectionValues(value);
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (entry) =>
      typeof entry === 'string' ||
      typeof entry === 'number' ||
      typeof entry === 'boolean',
  );
};

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

    displayValues[field.field_id] = toDisplayValue(field, rawValue);

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
