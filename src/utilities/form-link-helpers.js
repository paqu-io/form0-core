import { flattenFields } from './field-helpers.js';

export const FORM_LINK_VALUE_DELIMITER = '%&---&%';

function buildFieldLookup(form) {
  const lookup = new Map();
  if (!form || !Array.isArray(form.elements)) {
    return lookup;
  }

  const fields = flattenFields(form.elements);
  fields.forEach((field) => {
    if (!field) return;
    if (field.key) {
      lookup.set(field.key, field);
    }
    if (field.data_name) {
      lookup.set(field.data_name, field);
    }
  });

  return lookup;
}

function resolveFormField(form, identifier) {
  if (!identifier || typeof identifier !== 'string') {
    return null;
  }

  const lookup = buildFieldLookup(form);
  return lookup.get(identifier) || null;
}

function normalizeLinkedRecords(records = []) {
  if (!Array.isArray(records)) {
    return [];
  }

  return records
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const recordId = typeof entry.record_id === 'string' ? entry.record_id.trim() : '';
      const title = typeof entry.title === 'string' ? entry.title : null;
      const defaults = entry.defaults && typeof entry.defaults === 'object' ? entry.defaults : {};

      return {
        record_id: recordId,
        title,
        defaults,
      };
    })
    .filter((entry) => entry.record_id !== '');
}

function resolveDestinationField(form, destinationId) {
  if (!destinationId || typeof destinationId !== 'string') {
    return null;
  }

  const lookup = buildFieldLookup(form);
  return lookup.get(destinationId) || null;
}

function aggregateDefaultValues(records, sourceFieldId, delimiter) {
  if (!sourceFieldId || typeof sourceFieldId !== 'string') {
    return '';
  }

  const collected = records
    .map((record) => {
      const rawValue = record.defaults?.[sourceFieldId];
      if (rawValue === undefined || rawValue === null) {
        return '';
      }
      if (Array.isArray(rawValue)) {
        return rawValue
          .map((value) => (value === null || value === undefined ? '' : String(value)))
          .filter((value) => value !== '')
          .join(', ');
      }
      return String(rawValue);
    })
    .filter((value) => value !== '');

  if (collected.length === 0) {
    return '';
  }

  return collected.join(delimiter);
}

function normalizeSingleValue(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return '';
  }

  if (Array.isArray(rawValue)) {
    return rawValue
      .map((value) => (value === null || value === undefined ? '' : String(value)))
      .filter((value) => value !== '')
      .join(', ');
  }

  if (typeof rawValue === 'object') {
    try {
      return JSON.stringify(rawValue);
    } catch (err) {
      return '';
    }
  }

  return String(rawValue);
}

function convertToChoiceStructure(field, rawValue) {
  const value = normalizeSingleValue(rawValue).trim();
  if (!value) {
    return { choice: [], other: [] };
  }

  const matchingChoice = (field.choices || []).find((choice) => choice.value === value);
  if (!matchingChoice) {
    const allowedValues = (field.choices || []).map((choice) => choice.value).join(', ');
    throw new Error(
      `FormLinkField destination "${field.data_name}" expected a choice value matching one of: ${allowedValues}. Received "${value}"`
    );
  }

  return {
    choice: [
      {
        value: matchingChoice.value,
        label: matchingChoice.label,
      },
    ],
    other: [],
  };
}

function convertToMultiChoiceStructure(field, rawValue) {
  const value = normalizeSingleValue(rawValue);
  if (!value) {
    return { choices: [], other: [] };
  }

  const requestedValues = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');

  if (requestedValues.length === 0) {
    return { choices: [], other: [] };
  }

  const resolvedChoices = requestedValues.map((requested) => {
    const match = (field.choices || []).find((choice) => choice.value === requested);
    if (!match) {
      const allowedValues = (field.choices || []).map((choice) => choice.value).join(', ');
      throw new Error(
        `FormLinkField destination "${field.data_name}" received unsupported choice "${requested}". Allowed values: ${allowedValues}`
      );
    }
    return {
      value: match.value,
      label: match.label,
    };
  });

  return {
    choices: resolvedChoices,
    other: [],
  };
}

function convertValueForDestination(field, rawValue, delimiter) {
  switch (field.type) {
    case 'TextField': {
      if (rawValue === null || rawValue === undefined) {
        return '';
      }
      if (Array.isArray(rawValue)) {
        return rawValue
          .map((value) => (value === null || value === undefined ? '' : String(value)))
          .filter((value) => value !== '')
          .join(delimiter);
      }
      if (typeof rawValue === 'object') {
        return normalizeSingleValue(rawValue);
      }
      return String(rawValue);
    }
    case 'SingleChoiceField':
    case 'BooleanField':
      return convertToChoiceStructure(field, rawValue);
    case 'MultiChoiceField':
      return convertToMultiChoiceStructure(field, rawValue);
    case 'NumericField': {
      if (rawValue === null || rawValue === undefined || rawValue === '') {
        return null;
      }
      const numericValue = Number(rawValue);
      if (!Number.isFinite(numericValue)) {
        throw new Error(
          `FormLinkField destination "${field.data_name}" expected a numeric value. Received "${rawValue}"`
        );
      }
      if (field.format === 'integer' && !Number.isInteger(numericValue)) {
        throw new Error(
          `FormLinkField destination "${field.data_name}" requires an integer. Received "${rawValue}"`
        );
      }
      return numericValue;
    }
    case 'DateField':
    case 'TimeField': {
      if (rawValue === null || rawValue === undefined || rawValue === '') {
        return null;
      }
      return String(rawValue);
    }
    default:
      return rawValue;
  }
}

export function applyLinkedRecordSelection({
  form,
  values,
  fieldIdentifier,
  records = [],
  delimiter = FORM_LINK_VALUE_DELIMITER,
}) {
  if (!form || typeof form !== 'object') {
    throw new Error('applyLinkedRecordSelection requires a form definition');
  }

  if (!values || typeof values !== 'object') {
    throw new Error('applyLinkedRecordSelection requires a values object from the form engine state');
  }

  const field = resolveFormField(form, fieldIdentifier);
  if (!field) {
    throw new Error(`applyLinkedRecordSelection could not find field "${fieldIdentifier}" in the provided form`);
  }

  if (field.type !== 'FormLinkField') {
    throw new Error(`applyLinkedRecordSelection can only target FormLinkField fields (received ${field.type})`);
  }

  const normalizedRecords = normalizeLinkedRecords(records);

  if (field.allow_multiple_records !== true && normalizedRecords.length > 1) {
    throw new Error(
      `FormLinkField "${field.data_name}" does not allow multiple records but received ${normalizedRecords.length}`
    );
  }

  const selectedRecords = field.allow_multiple_records === true ? normalizedRecords : normalizedRecords.slice(0, 1);

  values[field.data_name] = selectedRecords.map((record) => ({
    record_id: record.record_id,
    title: record.title,
    defaults: record.defaults,
  }));

  if (Array.isArray(field.record_defaults) && field.record_defaults.length > 0) {
    field.record_defaults.forEach((mapping) => {
      if (!mapping || typeof mapping !== 'object') {
        return;
      }

      const destinationField = resolveDestinationField(form, mapping.destination_field_id);
      if (!destinationField) {
        return;
      }

      if (field.allow_multiple_records === true) {
        const aggregated = aggregateDefaultValues(selectedRecords, mapping.source_field_id, delimiter);
        values[destinationField.data_name] = aggregated;
        return;
      }

      const primaryRecord = selectedRecords[0] || null;
      const rawValue = primaryRecord?.defaults?.[mapping.source_field_id];

      if (primaryRecord && rawValue === undefined) {
        throw new Error(
          `FormLinkField destination "${destinationField.data_name}" could not find value for source_field_id "${mapping.source_field_id}" in the linked record defaults`
        );
      }

      values[destinationField.data_name] = convertValueForDestination(
        destinationField,
        rawValue,
        delimiter
      );
    });
  }

  return values[field.data_name];
}
