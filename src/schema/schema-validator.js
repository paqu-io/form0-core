import { flattenFields } from '../utilities/field-helpers.js';
import { validateFieldSchema, validateDefaultValue } from './field-schema-registry.js';
import { isSupportedFieldType } from '../utilities/field-types.js';
import { validateFieldConditions } from './operators.js';
import { validateFormAIMetadata } from './ai-metadata-validator.js';
import { buildDatasetDescriptors } from '../utilities/dataset-descriptors.js';

const toNonEmptyString = (value) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const getDescriptorFieldReferences = (field) =>
  new Set(
    [field?.field_id, field?.output_key, field?.key, field?.data_name, ...(field?.aliases || [])]
      .map(toNonEmptyString)
      .filter(Boolean)
  );

const validateScopedTitleFields = (form, errors) => {
  const descriptors = buildDatasetDescriptors({ form });
  const allReferenceDatasets = new Map();

  descriptors.forEach((descriptor) => {
    (descriptor.fields || []).forEach((field) => {
      getDescriptorFieldReferences(field).forEach((reference) => {
        if (!allReferenceDatasets.has(reference)) {
          allReferenceDatasets.set(reference, new Set());
        }
        allReferenceDatasets.get(reference).add(descriptor.id);
      });
    });
  });

  descriptors.forEach((descriptor) => {
    const titleField = descriptor.title_field;
    if (!titleField) {
      return;
    }

    const scopeLabel = descriptor.kind === 'root' ? 'title_field' : `RepeatableSection title_field`;
    const titleValidation = validateFieldSchema(titleField);
    if (!titleValidation.isValid) {
      errors.push(...titleValidation.errors.map((error) => `${scopeLabel}: ${error}`));
      return;
    }

    const scopedFields = descriptor.fields || [];
    titleField.elements.forEach((entry) => {
      const reference = toNonEmptyString(entry);
      if (!reference) {
        return;
      }

      const matchedField = scopedFields.find((field) =>
        getDescriptorFieldReferences(field).has(reference)
      );
      if (!matchedField) {
        if (allReferenceDatasets.has(reference)) {
          errors.push(`${scopeLabel} reference "${reference}" is outside its record scope`);
        } else {
          errors.push(`${scopeLabel} reference "${reference}" does not match any field`);
        }
        return;
      }

      if (matchedField.title_eligible !== true) {
        errors.push(
          `${scopeLabel} reference "${reference}" uses unsupported field type ${matchedField.field_type}`
        );
      }
    });
  });
};

export function validateSchema(form) {
  const fields = flattenFields(form.elements);
  const seenDataNames = new Set();
  const seenKeys = new Set();
  const duplicateDataNames = new Set();
  const duplicateKeys = new Set();
  const errors = [];

  const formAIValidation = validateFormAIMetadata(form);
  if (!formAIValidation.isValid) {
    errors.push(...formAIValidation.errors);
  }

  // Create a map of all fields by key and data_name for condition validation
  const allFields = {};
  fields.forEach((field) => {
    if (field.key) {
      allFields[field.key] = field;
    }
    if (field.data_name) {
      allFields[field.data_name] = field;
    }
  });

  for (const field of fields) {
    if (!isSupportedFieldType(field.type)) {
      errors.push(`Unsupported field type: ${field.type}`);
      continue;
    }

    if (!field.data_name) {
      errors.push(`Missing data_name in field: ${field.label || field.key}`);
      continue;
    }

    if (field.data_name.length > 42) {
      errors.push(`data_name "${field.data_name}" exceeds 42 characters`);
    }

    if (!/^[a-z0-9_]+$/.test(field.data_name)) {
      errors.push(
        `Invalid data_name "${field.data_name}". Only a-z, 0-9 and underscores (_) are allowed.`
      );
    }

    if (seenDataNames.has(field.data_name)) {
      duplicateDataNames.add(field.data_name);
    }
    seenDataNames.add(field.data_name);

    if (!field.key) {
      errors.push(`Missing key for field "${field.data_name}"`);
      continue;
    }

    if (seenKeys.has(field.key)) {
      duplicateKeys.add(field.key);
    }
    seenKeys.add(field.key);

    // Validate default_value for all field types
    if (field.default_value !== undefined && field.default_value !== null) {
      const validation = validateDefaultValue(field, field.default_value);
      if (!validation.isValid) {
        errors.push(`Invalid default_value for ${field.data_name}: ${validation.error}`);
      }
    }

    // Validate field schema using the new registry
    const fieldValidation = validateFieldSchema(field);
    if (!fieldValidation.isValid) {
      errors.push(...fieldValidation.errors);
    }

    // Validate conditions for all field types
    if (field.visible_conditions) {
      const validation = validateFieldConditions(field, field.visible_conditions, allFields);
      if (!validation.isValid) {
        errors.push(...validation.errors);
      }
    }

    if (field.required_conditions) {
      const validation = validateFieldConditions(field, field.required_conditions, allFields);
      if (!validation.isValid) {
        errors.push(...validation.errors);
      }
    }

    if (field.read_only_conditions) {
      const validation = validateFieldConditions(field, field.read_only_conditions, allFields);
      if (!validation.isValid) {
        errors.push(...validation.errors);
      }
    }

    if (field.type === 'FormLinkField') {
      if (field.record_defaults != null && !Array.isArray(field.record_defaults)) {
        errors.push(
          `FormLinkField "${field.data_name}" record_defaults must be an array when provided`
        );
      } else if (Array.isArray(field.record_defaults)) {
        field.record_defaults.forEach((mapping, index) => {
          if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
            errors.push(
              `FormLinkField "${field.data_name}" record_defaults[${index}] must be an object`
            );
            return;
          }

          const destinationId = mapping.destination_field_id;
          if (!destinationId || typeof destinationId !== 'string' || destinationId.trim() === '') {
            errors.push(
              `FormLinkField "${field.data_name}" record_defaults[${index}].destination_field_id must be a non-empty string`
            );
            return;
          }

          const destinationField = allFields[destinationId];
          if (!destinationField) {
            errors.push(
              `FormLinkField "${field.data_name}" record_defaults[${index}].destination_field_id "${destinationId}" does not match any field in this form`
            );
            return;
          }

          const destinationType = destinationField.type;
          const allowMultiple = field.allow_multiple_records === true;
          const allowedSingleValueTypes = new Set([
            'TextField',
            'SingleChoiceField',
            'MultiChoiceField',
            'BooleanField',
            'NumericField',
            'DateField',
            'TimeField',
          ]);

          if (allowMultiple) {
            if (destinationType !== 'TextField') {
              errors.push(
                `FormLinkField "${field.data_name}" record_defaults[${index}].destination_field_id "${destinationId}" must reference a TextField when allow_multiple_records is true`
              );
            }
          } else if (!allowedSingleValueTypes.has(destinationType)) {
            errors.push(
              `FormLinkField "${field.data_name}" record_defaults[${index}].destination_field_id "${destinationId}" must reference one of: ${Array.from(allowedSingleValueTypes).join(', ')}`
            );
          }
        });
      }

      if (field.record_conditions != null) {
        if (typeof field.record_conditions !== 'object' || Array.isArray(field.record_conditions)) {
          errors.push(
            `FormLinkField "${field.data_name}" record_conditions must be an object when provided`
          );
        }
      }
    }
  }

  // Validate top-level status_field and title_field if present
  if (form.status_field) {
    const statusValidation = validateFieldSchema(form.status_field);
    if (!statusValidation.isValid) {
      errors.push(...statusValidation.errors.map((e) => `status_field: ${e}`));
    }
    // Validate default_value if present
    if (form.status_field.default_value !== undefined && form.status_field.default_value !== null) {
      const dv = validateDefaultValue(form.status_field, form.status_field.default_value);
      if (!dv.isValid) {
        errors.push(`status_field default_value: ${dv.error}`);
      }
    }
  }
  validateScopedTitleFields(form, errors);

  // Add duplicate errors to the main errors array
  if (duplicateDataNames.size > 0) {
    errors.push(`Duplicate data_name(s): ${Array.from(duplicateDataNames).join(', ')}`);
  }

  if (duplicateKeys.size > 0) {
    errors.push(`Duplicate key(s): ${Array.from(duplicateKeys).join(', ')}`);
  }

  if (form.form_links !== undefined) {
    const links = form.form_links;
    if (typeof links !== 'object' || links === null || Array.isArray(links)) {
      errors.push('form_links must be an object when provided');
    } else {
      const { to = [], from = [] } = links;

      if (to !== undefined) {
        if (!Array.isArray(to)) {
          errors.push('form_links.to must be an array when provided');
        } else {
          to.forEach((entry, index) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
              errors.push(`form_links.to[${index}] must be an object`);
              return;
            }

            const key = entry.form_link_field_key;
            if (!key || typeof key !== 'string' || key.trim() === '') {
              errors.push(`form_links.to[${index}].form_link_field_key must be a non-empty string`);
            } else {
              const fieldRef = allFields[key];
              if (fieldRef && fieldRef.type !== 'FormLinkField') {
                errors.push(
                  `form_links.to[${index}].form_link_field_key "${key}" must reference a FormLinkField`
                );
              }
            }

            if (
              !entry.form_id ||
              typeof entry.form_id !== 'string' ||
              entry.form_id.trim() === ''
            ) {
              errors.push(`form_links.to[${index}].form_id must be a non-empty string`);
            }
          });
        }
      }

      if (from !== undefined) {
        if (!Array.isArray(from)) {
          errors.push('form_links.from must be an array when provided');
        } else {
          from.forEach((entry, index) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
              errors.push(`form_links.from[${index}] must be an object`);
              return;
            }

            if (
              !entry.form_id ||
              typeof entry.form_id !== 'string' ||
              entry.form_id.trim() === ''
            ) {
              errors.push(`form_links.from[${index}].form_id must be a non-empty string`);
            }

            if (
              entry.form_link_field_key !== undefined &&
              entry.form_link_field_key !== null &&
              entry.form_link_field_key !== '' &&
              typeof entry.form_link_field_key !== 'string'
            ) {
              errors.push(
                `form_links.from[${index}].form_link_field_key must be a string when provided`
              );
            }
          });
        }
      }
    }
  }

  // Validate events section if present
  if (form.events) {
    if (typeof form.events !== 'object') {
      errors.push('Form events must be an object');
    }

    if (form.events.code && typeof form.events.code !== 'string') {
      errors.push('Form events.code must be a string');
    }
  }

  // Throw all errors at once if any were found
  if (errors.length > 0) {
    const errorMessage =
      errors.length === 1
        ? errors[0]
        : `Validation failed with ${errors.length} errors:\n${errors.map((error, index) => `${index + 1}. ${error}`).join('\n')}`;
    throw new Error(errorMessage);
  }
}
