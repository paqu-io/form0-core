/**
 * Record transformation utilities for form0
 * Creates structured record format for submission with metadata
 */

import { FIELD_SPECS } from '../schema/field-specs.js';
import { recordVersion } from './version-utils.js';

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
export function createStructuredRecord(state, fields = null, options = {}, id = null ) {
  // Compute final version values
  const finalVersion = options.version || 1;
  const finalChildVersion = options.childVersion || 1;
  
  // Validate final computed versions (including fallbacks)
  if (!recordVersion.isValid(finalVersion)) {
    throw new Error(`Invalid record version: ${finalVersion}. Must be a positive integer (e.g., 1, 2, 3)`);
  }
  
  if (!recordVersion.isValid(finalChildVersion)) {
    throw new Error(`Invalid child record version: ${finalChildVersion}. Must be a positive integer (e.g., 1, 2, 3)`);
  }
  
  const now = new Date().toISOString();
  
  // Determine client timestamps (only set if not already provided)
  const clientCreatedAt = options.created_at_client || now;
  const clientUpdatedAt = now; // Always updated on each submission
  
  // Server timestamps (null for now, will be set by actual server/database)
  const serverCreatedAt = options.created_at_server || null;
  const serverUpdatedAt = options.updated_at_server || null;
  
  // Transform values from data_name keys to field keys (with fallback to data_name)
  const form_values = {};
  
  // Create mapping from data_name to preferred key (field.key or fallback to field.data_name)
  const dataNameToKeyMap = new Map();
  
  // Check if fields is a valid array
  if (Array.isArray(fields)) {
    fields.forEach(field => {
      // Use field.key if it exists and is not empty, otherwise fallback to data_name
      const preferredKey = (field.key && field.key.trim() !== '') ? field.key : field.data_name;
      dataNameToKeyMap.set(field.data_name, preferredKey);
    });
  } else {
    console.warn('[form0] createStructuredRecord: fields parameter is not an array, using data_names as keys');
  }
  
  // Create mapping from data_name to field for output formatting
  const dataNameToFieldMap = new Map();
  if (Array.isArray(fields)) {
    fields.forEach(field => {
      dataNameToFieldMap.set(field.data_name, field);
    });
  }
  // Create mapping from key to field for title resolution
  const keyToFieldMap = new Map();
  if (Array.isArray(fields)) {
    fields.forEach(field => {
      if (field.key) keyToFieldMap.set(field.key, field);
    });
  }
  
  // Build a comprehensive tree structure for nested RepeatableSections
  const sectionFields = new Set();
  const repeatableSectionTree = new Map(); // Map to store RepeatableSection hierarchy
  const fieldOwnership = new Map(); // Map field data_name to its parent RepeatableSection path
  
  // Helper function to build RepeatableSection tree and field ownership
  const buildRepeatableSectionTree = (elements, parentPath = []) => {
    if (!Array.isArray(elements)) return;
    
    elements.forEach(element => {
      if (element.type === 'Section') {
        sectionFields.add(element.data_name);
        // Recursively process Section children with same parentPath
        // (Sections don't change the RepeatableSection parentage)
        if (Array.isArray(element.elements)) {
          buildRepeatableSectionTree(element.elements, parentPath);
        }
      } else if (element.type === 'RepeatableSection') {
        const preferredKey = (element.key && element.key.trim() !== '') ? element.key : element.data_name;
        const currentPath = [...parentPath, preferredKey];
        
        // Store this RepeatableSection in the tree
        repeatableSectionTree.set(element.data_name, {
          preferredKey,
          field: element,
          parentPath: [...parentPath], // Copy to avoid reference issues
          currentPath: [...currentPath], // Copy to avoid reference issues
          children: new Map(), // Will store child RepeatableSections
          fields: new Map()    // Will store direct child fields
        });
        
        // Recursively process RepeatableSection children with updated path
        if (Array.isArray(element.elements)) {
          buildRepeatableSectionTree(element.elements, currentPath);
        }
      } else {
        // This is a regular field - determine its ownership
        const preferredFieldKey = (element.key && element.key.trim() !== '') ? element.key : element.data_name;
        fieldOwnership.set(element.data_name, {
          preferredKey: preferredFieldKey,
          field: element,
          parentPath: [...parentPath] // Copy the current path
        });
      }
    });
  };
  
  // Build the tree structure from original nested schema elements (if available)
  if (options.originalElements && Array.isArray(options.originalElements)) {
    buildRepeatableSectionTree(options.originalElements);
  } else if (Array.isArray(fields)) {
    buildRepeatableSectionTree(fields);
  }
  
  // Establish parent-child relationships between RepeatableSections
  for (const [dataName, repInfo] of repeatableSectionTree) {
    if (repInfo.parentPath.length > 0) {
      const parentKey = repInfo.parentPath[repInfo.parentPath.length - 1];
      // Find the parent RepeatableSection
      for (const [parentDataName, parentRepInfo] of repeatableSectionTree) {
        if (parentRepInfo.preferredKey === parentKey) {
          parentRepInfo.children.set(dataName, repInfo);
          break;
        }
      }
    }
  }
  
  // Populate fields for each RepeatableSection based on field ownership
  for (const [fieldDataName, fieldInfo] of fieldOwnership) {
    if (fieldInfo.parentPath.length > 0) {
      // Find the immediate parent RepeatableSection for this field
      const immediateParentKey = fieldInfo.parentPath[fieldInfo.parentPath.length - 1];
      // Find the RepeatableSection with this preferred key
      for (const [dataName, repInfo] of repeatableSectionTree) {
        if (repInfo.preferredKey === immediateParentKey) {
          repInfo.fields.set(fieldDataName, {
            preferredKey: fieldInfo.preferredKey,
            field: fieldInfo.field
          });
          break;
        }
      }
    }
  }

    // Transform the values object using the preferred keys
  for (const [dataName, value] of Object.entries(state.values)) {
    // Skip flattened choice fields (created by form renderer for allow_other fields)
    if (dataName.endsWith('_choice') || dataName.endsWith('_choices') || dataName.endsWith('_other')) {
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
    
    const preferredKey = dataNameToKeyMap.get(dataName);
    const field = dataNameToFieldMap.get(dataName);
    
    if (preferredKey) {
      // Apply output formatting if field spec exists
      let processedValue = value;
      if (field && field.type && FIELD_SPECS[field.type] && FIELD_SPECS[field.type].outputProducer) {
        try {
          processedValue = FIELD_SPECS[field.type].outputProducer(field, value);
        } catch (err) {
          console.warn(`[form0] createStructuredRecord: outputProducer failed for ${field.type} field "${dataName}":`, err);
          processedValue = value; // Fallback to raw value
        }
      }
      form_values[preferredKey] = processedValue;
    } else {
      // Final fallback: keep original data_name if no field mapping found
      form_values[dataName] = value;
    }
  }

  // Enhanced recursive function to process nested RepeatableSections
  const processRepeatableSection = (repInfo, currentPath = []) => {
    const repeatableField = repInfo.field;
    const pathKey = repInfo.preferredKey;
    
    // Get child record IDs from options using the full path
    const getNestedChildIds = (path) => {
      let current = options.childRecordIds || {};
      
      for (let i = 0; i < path.length; i++) {
        const key = path[i];
        
        if (i === path.length - 1) {
          // Last key: this is the RepeatableSection we want
          if (current[key]) {
            return Array.isArray(current[key]) ? current[key] : (current[key]._records || []);
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
      
      return Array.isArray(current) ? current : (current._records || []);
    };
    
    const childIds = getNestedChildIds([...currentPath, pathKey]);
    
    // Determine how many child records to create
    let recordCount = 1; // Default to 1 record for CLI compatibility
    
    // Check if any fields in this RepeatableSection have values
    const hasDirectFieldValues = Array.from(repInfo.fields.values()).some(fieldInfo => {
      const fieldValue = state.values[fieldInfo.field.data_name];
      return fieldValue !== null && fieldValue !== undefined;
    });
    
    // Check if any child RepeatableSections have values
    const hasChildRepeatableSectionValues = Array.from(repInfo.children.values()).some(childRepInfo => {
      return Array.from(childRepInfo.fields.values()).some(fieldInfo => {
        const fieldValue = state.values[fieldInfo.field.data_name];
        return fieldValue !== null && fieldValue !== undefined;
      });
    });
    
    const hasAnyValues = hasDirectFieldValues || hasChildRepeatableSectionValues;
    
    if (hasAnyValues || childIds.length > 0) {
      recordCount = Math.max(1, childIds.length);
      
      // Create child records array
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
          geometry: null
        };
        
        // Add direct child field values
        for (const [fieldDataName, fieldInfo] of repInfo.fields) {
          const fieldValue = state.values[fieldDataName];
          if (fieldValue !== undefined) {
            // Apply output formatting if field spec exists
            let processedValue = fieldValue;
            const field = fieldInfo.field;
            if (field && field.type && FIELD_SPECS[field.type] && FIELD_SPECS[field.type].outputProducer) {
              try {
                processedValue = FIELD_SPECS[field.type].outputProducer(field, fieldValue);
              } catch (err) {
                console.warn(`[form0] createStructuredRecord: outputProducer failed for ${field.type} field "${fieldDataName}" in RepeatableSection:`, err);
                processedValue = fieldValue; // Fallback to raw value
              }
            }
            
            // For now, all field values go into the first record
            if (i === 0) {
              childRecord.form_values[fieldInfo.preferredKey] = processedValue;
            } else {
              // For additional records, set null values (ready for future implementation)
              childRecord.form_values[fieldInfo.preferredKey] = null;
            }
          }
        }
        
                 // Recursively process child RepeatableSections
         for (const [childDataName, childRepInfo] of repInfo.children) {
           const childRepeatableArray = processRepeatableSection(childRepInfo, [...currentPath, pathKey]);
           if (childRepeatableArray.length > 0) {
             // For now, add the child RepeatableSection to the first record
             if (i === 0) {
               childRecord.form_values[childRepInfo.preferredKey] = childRepeatableArray;
             } else {
               // For additional records, create empty arrays (ready for future implementation)
               childRecord.form_values[childRepInfo.preferredKey] = [];
             }
           }
         }
        
        childRecords.push(childRecord);
      }
      
      return childRecords;
    }
    
    return []; // Return empty array if no values
  };
  
  // Process all top-level RepeatableSections (those with no parent)
  for (const [dataName, repInfo] of repeatableSectionTree) {
    if (repInfo.parentPath.length === 0) {
      // This is a top-level RepeatableSection
      const childRecords = processRepeatableSection(repInfo);
      if (childRecords.length > 0) {
        form_values[repInfo.preferredKey] = childRecords;
      }
    }
  }
  
  // Build structured record with metadata
  const record = {
    '@status': options['@status'] || null,
    '@title': options['@title'] || null,
    version: finalVersion,
    draft: false,
    id: options.mainRecordId || id || null, // Use new options structure, fallback to old id param
    changeset_id: options.changeset_id || null, // Changeset for grouping related changes
    created_at: clientCreatedAt, // User's creation time is canonical
    updated_at: serverUpdatedAt, // Server's update time is canonical
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
    changeset_id: null,
    
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
    
    // Form values
    form_values,
    
    // Override any defaults with provided options (excluding our internal processing keys)
    ...Object.fromEntries(
      Object.entries(options).filter(([key]) => 
        !['mainRecordId', 'childRecordIds', 'originalElements', 'status_field', 'title_field'].includes(key)
      )
    ),
    
    // Ensure our specific handling isn't overridden
    id: options.mainRecordId || id || null,
    changeset_id: options.changeset_id || null, // Ensure changeset_id isn't overridden
    created_at: clientCreatedAt, // Ensure canonical created_at isn't overridden
    updated_at: serverUpdatedAt, // Ensure canonical updated_at isn't overridden
    form_values // Ensure form_values isn't overridden
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
            const found = (fieldDef.choices || []).find(c => c.value === v);
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
              const found = (fieldDef.choices || []).find(cc => cc.value === c.value);
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
            const found = (fieldDef.choices || []).find(c => c.value === v);
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