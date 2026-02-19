/**
 * Record transformation utilities for form0
 * Creates structured record format for submission with metadata
 */

import { FIELD_SPECS } from '../schema/field-specs.js';
import { recordVersion } from './version-utils.js';
import { buildRepeatableMetadata } from './repeatable-helpers.js';

const hasMeaningfulValue = (value) => {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim() !== '';
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasMeaningfulValue(item));
  }

  if (typeof value === 'object') {
    return Object.values(value).some((item) => hasMeaningfulValue(item));
  }

  // Numbers, booleans, dates, etc. are considered meaningful if present
  return true;
};

const hasMeaningfulRecord = (record) => {
  if (!record || typeof record !== 'object') {
    return false;
  }

  if (hasMeaningfulValue(record.geometry)) {
    return true;
  }

  if (record.form_values && typeof record.form_values === 'object') {
    return hasMeaningfulValue(record.form_values);
  }

  return false;
};

/**
 * Create structured record from form engine state with support for unlimited RepeatableSection nesting
 * @param {Object} state - Form engine state {values, errors, visible, required, read_only}
 * @param {Array} [fields] - Optional flattened fields array from schema (for key mapping)
 * @param {Object} options - Additional options for record creation
 *   - mainRecordId: UUID for the main record
 *   - childRecordIds: Nested object structure for RepeatableSection child record UUIDs
 *   - originalElements: Original nested form elements (for proper RepeatableSection nesting)
 * @param {string} [id] - DEPRECATED: Use options.mainRecordId instead
 * @returns {Object} Structured record ready for submission
 *
 * @example
 * // Simple RepeatableSection:
 * options = {
 *   mainRecordId: "main-uuid",
 *   childRecordIds: {
 *     "repA": ["child-1", "child-2", "child-3"]
 *   }
 * }
 *
 * // Nested RepeatableSections:
 * options = {
 *   mainRecordId: "main-uuid",
 *   childRecordIds: {
 *     "repA": {
 *       _records: ["repA-record-1", "repA-record-2"],
 *       "repA-record-1": {
 *         "repB": ["repB-child-1", "repB-child-2"]
 *       }
 *     }
 *   }
 * }
 */
export function createStructuredRecord(state, fields = null, options = {}, id = null) {
  // Compute final version values
  const finalVersion = options.version || 1;
  const finalChildVersion = options.childVersion || 1;

  const rawFieldKeyMode = options.fieldKeyMode ?? options.field_key_mode ?? 'prefer-key';
  const normalizedFieldKeyMode =
    typeof rawFieldKeyMode === 'string' ? rawFieldKeyMode.toLowerCase() : 'prefer-key';
  const useDataNameKeys =
    normalizedFieldKeyMode === 'data-name' ||
    normalizedFieldKeyMode === 'data_name' ||
    normalizedFieldKeyMode === 'dataname';
  if (
    !useDataNameKeys &&
    normalizedFieldKeyMode !== 'prefer-key' &&
    normalizedFieldKeyMode !== 'key' &&
    normalizedFieldKeyMode !== 'keys'
  ) {
    console.warn(
      `[form0] createStructuredRecord: unrecognized fieldKeyMode "${rawFieldKeyMode}", falling back to preferred keys`
    );
  }

  const resolveFieldOutputKey = (field, preferredKey, dataName) => {
    if (useDataNameKeys) {
      if (field && field.data_name) return field.data_name;
      if (dataName) return dataName;
    }

    if (preferredKey) return preferredKey;
    if (field && field.data_name) return field.data_name;
    return dataName || preferredKey;
  };

  const resolveRepeatableOutputKey = (repInfo) => {
    const dataName = repInfo?.field?.data_name;
    if (useDataNameKeys && dataName) {
      return dataName;
    }
    return repInfo?.preferredKey ?? dataName;
  };

  // Validate final computed versions (including fallbacks)
  if (!recordVersion.isValid(finalVersion)) {
    throw new Error(
      `Invalid record version: ${finalVersion}. Must be a positive integer (e.g., 1, 2, 3)`
    );
  }

  if (!recordVersion.isValid(finalChildVersion)) {
    throw new Error(
      `Invalid child record version: ${finalChildVersion}. Must be a positive integer (e.g., 1, 2, 3)`
    );
  }

  const now = new Date().toISOString();

  // Allow state-provided timestamp overrides if options are missing
  const stateCreatedAtClient =
    state?.values?.created_at_client || state?.created_at_client || undefined;
  const stateUpdatedAtClient =
    state?.values?.updated_at_client || state?.updated_at_client || undefined;
  const stateCreatedAtServer =
    state?.values?.created_at_server || state?.created_at_server || undefined;
  const stateUpdatedAtServer =
    state?.values?.updated_at_server || state?.updated_at_server || undefined;

  // Determine client timestamps (only set if not already provided)
  const clientCreatedAt = options.created_at_client || stateCreatedAtClient || now;
  const clientUpdatedAt = options.updated_at_client || stateUpdatedAtClient || now; // Updated at submission time

  // Server timestamps (null for now, will be set by actual server/database)
  const serverCreatedAt = options.created_at_server || stateCreatedAtServer || null;
  const serverUpdatedAt = options.updated_at_server || stateUpdatedAtServer || null;

  // Transform values from data_name keys to field keys (with fallback to data_name)
  const form_values = {};

  // Create mapping from data_name to preferred key (field.key or fallback to field.data_name)
  const dataNameToKeyMap = new Map();

  // Check if fields is a valid array
  if (Array.isArray(fields)) {
    fields.forEach((field) => {
      // Use field.key if it exists and is not empty, otherwise fallback to data_name
      const preferredKey = field.key && field.key.trim() !== '' ? field.key : field.data_name;
      dataNameToKeyMap.set(field.data_name, preferredKey);
    });
  } else {
    console.warn(
      '[form0] createStructuredRecord: fields parameter is not an array, using data_names as keys'
    );
  }

  // Create mapping from data_name to field for output formatting
  const dataNameToFieldMap = new Map();
  if (Array.isArray(fields)) {
    fields.forEach((field) => {
      dataNameToFieldMap.set(field.data_name, field);
    });
  }
  // Create mapping from key to field for title resolution
  const keyToFieldMap = new Map();
  if (Array.isArray(fields)) {
    fields.forEach((field) => {
      if (field.key) keyToFieldMap.set(field.key, field);
    });
  }

  // Build a comprehensive tree structure for nested RepeatableSections
  const elementsSource = Array.isArray(options.originalElements)
    ? options.originalElements
    : Array.isArray(fields)
    ? fields
    : [];

  const {
    repeatableSectionTree,
    fieldOwnership,
    sectionFields,
  } = buildRepeatableMetadata(elementsSource);

  const hasStructuredRepeatableState =
    state &&
    Object.prototype.hasOwnProperty.call(state, 'repeatable') &&
    state.repeatable &&
    typeof state.repeatable === 'object';

  // Transform the values object using the preferred keys
  for (const [dataName, value] of Object.entries(state.values)) {
    // Skip flattened choice fields (created by form renderer for allow_other fields)
    if (
      dataName.endsWith('_choice') ||
      dataName.endsWith('_choices') ||
      dataName.endsWith('_other')
    ) {
      continue;
    }

    // Skip Section fields (organizational containers, not actual data)
    if (sectionFields.has(dataName)) {
      continue;
    }

    // Skip RepeatableSection fields (handled separately below)
    if (repeatableSectionTree.has(dataName)) {
      continue;
    }

    // Skip fields that belong to RepeatableSections (they'll be processed within their parent RepeatableSection)
    const fieldOwnershipInfo = fieldOwnership.get(dataName);
    if (fieldOwnershipInfo && fieldOwnershipInfo.parentPath.length > 0) {
      continue;
    }

    const field = dataNameToFieldMap.get(dataName);
    const preferredKey = dataNameToKeyMap.get(dataName);

    // Apply output formatting if field spec exists
    let processedValue = value;
    if (
      field &&
      field.type &&
      FIELD_SPECS[field.type] &&
      FIELD_SPECS[field.type].outputProducer
    ) {
      try {
        processedValue = FIELD_SPECS[field.type].outputProducer(field, value);
      } catch (err) {
        console.warn(
          `[form0] createStructuredRecord: outputProducer failed for ${field.type} field "${dataName}":`,
          err
        );
        processedValue = value; // Fallback to raw value
      }
    }

    const outputKey = preferredKey
      ? resolveFieldOutputKey(field, preferredKey, dataName)
      : resolveFieldOutputKey(field, null, dataName);

    form_values[outputKey] = processedValue;
  }

  // Enhanced recursive function to process nested RepeatableSections
  const processRepeatableSection = (repInfo, currentPath = [], structuredInstances = null) => {
    const pathKey = repInfo.preferredKey;

    // Get child record IDs from options using the full path
    const getNestedChildIds = (path) => {
      let current = options.childRecordIds || {};

      for (let i = 0; i < path.length; i++) {
        const key = path[i];

        if (i === path.length - 1) {
          // Last key: this is the RepeatableSection we want
          if (current[key]) {
            return Array.isArray(current[key]) ? current[key] : current[key]._records || [];
          }
          return [];
        } else {
          // Intermediate key: navigate through the nested structure
          current = current[key];
          if (!current) return [];

          // If current has _records, we need to navigate to the first record
          if (current._records && current._records.length > 0) {
            const recordId = current._records[0];
            current = current[recordId];
            if (!current) return [];
          }
        }
      }

      return Array.isArray(current) ? current : current._records || [];
    };

    const childIds = getNestedChildIds([...currentPath, pathKey]);

    // Structured RepeatableSection state supplied (new format)
    // Empty arrays are treated as explicit "no instances" and must not fall back
    // to legacy flattened behavior, which can emit phantom records.
    if (Array.isArray(structuredInstances)) {
      const recordCount = Math.max(structuredInstances.length, childIds.length);
      const childRecords = [];

      for (let i = 0; i < recordCount; i++) {
        const instanceState = structuredInstances[i] || {};
        const instanceValues = instanceState.values || {};
        const instanceRepeatable = instanceState.repeatable || {};
        const instanceCreatedAtClient = instanceState.created_at_client || clientCreatedAt;
        const instanceUpdatedAtClient = instanceState.updated_at_client || instanceCreatedAtClient;

        const childRecord = {
          created_at: instanceCreatedAtClient,
          updated_at: serverUpdatedAt,
          created_at_client: instanceCreatedAtClient,
          updated_at_client: instanceUpdatedAtClient,
          created_at_server: serverCreatedAt,
          updated_at_server: serverUpdatedAt,
          updated_location: null,
          draft: false,
          id: instanceState.id ?? instanceState.record_id ?? childIds[i] ?? null,
          form_values: {},
          created_duration: null,
          updated_duration: null,
          created_location: null,
          updated_duration_cumulative: null,
          version: instanceState.version || finalChildVersion,
          created_by_id: null,
          updated_by_id: null,
          changeset_id: options.changeset_id || null,
          geometry: instanceState.geometry ?? null,
        };

        for (const [fieldDataName, fieldInfo] of repInfo.fields) {
          if (!Object.prototype.hasOwnProperty.call(instanceValues, fieldDataName)) {
            continue;
          }

          const fieldValue = instanceValues[fieldDataName];
          let processedValue = fieldValue;
          const field = fieldInfo.field;
          if (
            field &&
            field.type &&
            FIELD_SPECS[field.type] &&
            FIELD_SPECS[field.type].outputProducer
          ) {
            try {
              processedValue = FIELD_SPECS[field.type].outputProducer(field, fieldValue);
            } catch (err) {
              console.warn(
                `[form0] createStructuredRecord: outputProducer failed for ${field.type} field "${fieldDataName}" in RepeatableSection:`,
                err
              );
              processedValue = fieldValue;
            }
          }

          const outputKey = resolveFieldOutputKey(
            fieldInfo.field,
            fieldInfo.preferredKey,
            fieldInfo.field?.data_name || fieldDataName
          );

          childRecord.form_values[outputKey] = processedValue;
        }

        for (const [, childRepInfo] of repInfo.children) {
          const rawNestedInstances = Object.prototype.hasOwnProperty.call(
            instanceRepeatable,
            childRepInfo.preferredKey
          )
            ? instanceRepeatable[childRepInfo.preferredKey]
            : [];
          const nestedInstances = Array.isArray(rawNestedInstances) ? rawNestedInstances : [];
          const childRepeatableArray = processRepeatableSection(
            childRepInfo,
            [...currentPath, pathKey],
            nestedInstances
          );
          const childOutputKey = resolveRepeatableOutputKey(childRepInfo);
          childRecord.form_values[childOutputKey] = childRepeatableArray;
        }

        if (hasMeaningfulRecord(childRecord)) {
          childRecords.push(childRecord);
        }
      }

      return childRecords;
    }

    // Legacy flattened RepeatableSection handling (single-instance only)
    let recordCount = 1; // Default to 1 record for CLI compatibility

    const hasDirectFieldValues = Array.from(repInfo.fields.values()).some((fieldInfo) => {
      const fieldValue = state.values[fieldInfo.field.data_name];
      return fieldValue !== null && fieldValue !== undefined;
    });

    const hasChildRepeatableSectionValues = Array.from(repInfo.children.values()).some(
      (childRepInfo) => {
        return Array.from(childRepInfo.fields.values()).some((fieldInfo) => {
          const fieldValue = state.values[fieldInfo.field.data_name];
          return fieldValue !== null && fieldValue !== undefined;
        });
      }
    );

    const hasAnyValues = hasDirectFieldValues || hasChildRepeatableSectionValues;

    if (hasAnyValues || childIds.length > 0) {
      recordCount = Math.max(1, childIds.length);

      const childRecords = [];

      for (let i = 0; i < recordCount; i++) {
        const childRecord = {
          created_at: clientCreatedAt, // User's creation time is canonical
          updated_at: serverUpdatedAt, // Server's update time is canonical
          created_at_client: clientCreatedAt,
          updated_at_client: clientUpdatedAt,
          created_at_server: serverCreatedAt,
          updated_at_server: serverUpdatedAt,
          updated_location: null,
          draft: false,
          id: childIds[i] || null,
          form_values: {},
          created_duration: null,
          updated_duration: null,
          created_location: null,
          updated_duration_cumulative: null,
          version: finalChildVersion,
          created_by_id: null,
          updated_by_id: null,
          changeset_id: options.changeset_id || null, // Same changeset as main record
          geometry: null,
        };

        // Add direct child field values
        for (const [fieldDataName, fieldInfo] of repInfo.fields) {
          const fieldValue = state.values[fieldDataName];
          if (fieldValue !== undefined) {
            // Apply output formatting if field spec exists
            let processedValue = fieldValue;
            const field = fieldInfo.field;
            if (
              field &&
              field.type &&
              FIELD_SPECS[field.type] &&
              FIELD_SPECS[field.type].outputProducer
            ) {
              try {
                processedValue = FIELD_SPECS[field.type].outputProducer(field, fieldValue);
              } catch (err) {
                console.warn(
                  `[form0] createStructuredRecord: outputProducer failed for ${field.type} field "${fieldDataName}" in RepeatableSection:`,
                  err
                );
                processedValue = fieldValue; // Fallback to raw value
              }
            }

            const outputKey = resolveFieldOutputKey(
              fieldInfo.field,
              fieldInfo.preferredKey,
              fieldInfo.field?.data_name || fieldDataName
            );

            // For now, all field values go into the first record
            if (i === 0) {
              childRecord.form_values[outputKey] = processedValue;
            } else {
              // For additional records, set null values (ready for future implementation)
              childRecord.form_values[outputKey] = null;
            }
          }
        }

        // Recursively process child RepeatableSections
        for (const [childDataName, childRepInfo] of repInfo.children) {
          const childRepeatableArray = processRepeatableSection(childRepInfo, [
            ...currentPath,
            pathKey,
          ]);
          if (childRepeatableArray.length > 0) {
            // For now, add the child RepeatableSection to the first record
            if (i === 0) {
              const childOutputKey = resolveRepeatableOutputKey(childRepInfo);
              childRecord.form_values[childOutputKey] = childRepeatableArray;
            } else {
              // For additional records, create empty arrays (ready for future implementation)
              const childOutputKey = resolveRepeatableOutputKey(childRepInfo);
              childRecord.form_values[childOutputKey] = [];
            }
          }
        }

        if (hasMeaningfulRecord(childRecord)) {
          childRecords.push(childRecord);
        }
      }

      return childRecords;
    }

    return []; // Return empty array if no values
  };

  // Process all top-level RepeatableSections (those with no parent)
  for (const [, repInfo] of repeatableSectionTree) {
    if (repInfo.parentPath.length === 0) {
      // This is a top-level RepeatableSection
      const rawStructuredInstances = hasStructuredRepeatableState
        ? Object.prototype.hasOwnProperty.call(state.repeatable, repInfo.preferredKey)
          ? state.repeatable[repInfo.preferredKey]
          : []
        : null;
      const structuredInstances = hasStructuredRepeatableState
        ? Array.isArray(rawStructuredInstances)
          ? rawStructuredInstances
          : []
        : null;

      const childRecords = processRepeatableSection(repInfo, [], structuredInstances);
      const repeatableOutputKey = resolveRepeatableOutputKey(repInfo);
      if (hasStructuredRepeatableState) {
        // In structured mode keep explicit repeatable keys, even when empty.
        form_values[repeatableOutputKey] = childRecords;
      } else if (childRecords.length > 0) {
        form_values[repeatableOutputKey] = childRecords;
      }
    }
  }

  // Build structured record with metadata
  const record = {
    '@status': options['@status'] || null,
    '@title': options['@title'] || null,
    version: finalVersion,
    draft: false,
    created_at_client: clientCreatedAt,
    updated_at_client: clientUpdatedAt,
    created_at_server: serverCreatedAt,
    updated_at_server: serverUpdatedAt,

    // User/organization metadata (null by default)
    created_by: null,
    created_by_id: null,
    updated_by: null,
    updated_by_id: null,
    main_org_id: null,
    sub_org_id: null,
    project_id: null,

    // Location metadata (null by default)
    created_location: null,
    updated_location: null,
    latitude: null,
    longitude: null,
    altitude: null,
    horizontal_accuracy: null,
    vertical_accuracy: null,

    // Duration metadata (null by default)
    created_duration: null,
    updated_duration: null,
    updated_duration_cumulative: null,

    // Form identification
    form_id: null, // To be set by the application

    // Override any defaults with provided options (excluding our internal processing keys)
    ...Object.fromEntries(
      Object.entries(options).filter(
        ([key]) =>
          ![
            'mainRecordId',
            'childRecordIds',
            'originalElements',
            'status_field',
            'title_field',
            'fieldKeyMode',
            'field_key_mode',
          ].includes(key)
      )
    ),

    // Ensure our specific handling isn't overridden (always set last)
    id: options.mainRecordId || id || null,
    changeset_id: options.changeset_id || null, // Ensure changeset_id isn't overridden
    created_at: clientCreatedAt, // Ensure canonical created_at isn't overridden
    updated_at: serverUpdatedAt, // Ensure canonical updated_at isn't overridden
    form_values, // Ensure form_values isn't overridden
  };

  // ==============================
  // Add top-level @title and @status
  // ==============================
  try {
    // Compute @title from TitleField elements if provided in options
    const titleField = options.title_field;
    if (titleField && Array.isArray(titleField.elements)) {
      const parts = [];
      for (const ref of titleField.elements) {
        let fieldDef = null;
        // Prefer key lookup
        if (keyToFieldMap.has(ref)) {
          fieldDef = keyToFieldMap.get(ref);
        } else if (dataNameToFieldMap.has(ref)) {
          fieldDef = dataNameToFieldMap.get(ref);
        }
        if (!fieldDef) continue;
        const value = state.values[fieldDef.data_name];
        if (value == null) continue;
        // Extract display text by field type
        if (fieldDef.type === 'SingleChoiceField') {
          let labels = [];
          if (value.choice && Array.isArray(value.choice) && value.choice.length > 0) {
            const v = value.choice[0].value;
            const found = (fieldDef.choices || []).find((c) => c.value === v);
            labels.push(found?.label || value.choice[0].label || v);
          }
          if (value.other && Array.isArray(value.other)) {
            for (const o of value.other) {
              if (o && (o.label || o.value)) labels.push(o.label || o.value);
            }
          }
          const text = labels.filter(Boolean).join(', ');
          if (text) parts.push(text);
        } else if (fieldDef.type === 'MultiChoiceField') {
          let labels = [];
          if (value.choices && Array.isArray(value.choices)) {
            for (const c of value.choices) {
              const found = (fieldDef.choices || []).find((cc) => cc.value === c.value);
              labels.push(found?.label || c.label || c.value);
            }
          }
          if (value.other && Array.isArray(value.other)) {
            for (const o of value.other) {
              if (o && (o.label || o.value)) labels.push(o.label || o.value);
            }
          }
          const text = labels.filter(Boolean).join(', ');
          if (text) parts.push(text);
        } else if (fieldDef.type === 'BooleanField') {
          let label = '';
          if (value.choice && Array.isArray(value.choice) && value.choice.length > 0) {
            const v = value.choice[0].value;
            const found = (fieldDef.choices || []).find((c) => c.value === v);
            label = found?.label || value.choice[0].label || v;
          }
          if (label) parts.push(label);
        } else {
          const text = typeof value === 'object' ? null : String(value);
          if (text && text.trim() !== '') parts.push(text);
        }
      }
      const titleText = parts.join(', ');
      if (titleText) {
        record['@title'] = titleText;
      } else {
        record['@title'] = null;
      }
    }
  } catch (err) {
    console.warn('[form0] createStructuredRecord: failed to compute @title:', err);
  }

  try {
    // Determine @status preference: explicit option -> option.status (compat) -> default
    let statusValue = options['@status'];
    if (statusValue == null && options.status != null) statusValue = options.status;
    if (statusValue == null && options.status_field && typeof options.status_field === 'object') {
      statusValue = options.status_field.default_value || null;
    }
    if (statusValue !== undefined) {
      record['@status'] = statusValue;
    }
  } catch (err) {
    console.warn('[form0] createStructuredRecord: failed to set @status:', err);
  }

  return record;
}
