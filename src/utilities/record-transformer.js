/**
 * Record transformation utilities for form0
 * Creates structured record format for submission with metadata
 */

/**
 * Create structured record from form engine state with support for unlimited RepeatableSection nesting
 * @param {Object} state - Form engine state {values, errors, visible, required, read_only}
 * @param {Array} [fields] - Optional flattened fields array from schema (for key mapping)
 * @param {Object} options - Additional options for record creation
 *   - mainRecordId: UUID for the main record
 *   - childRecordIds: Nested object structure for RepeatableSection child record UUIDs
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
  const now = new Date().toISOString();
  
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
        // Recursively process Section children
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
          parentPath,
          currentPath,
          children: new Map(), // Will store child RepeatableSections
          fields: new Map()    // Will store direct child fields
        });
        
        // Recursively process RepeatableSection children
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
        
        // If this field belongs to a RepeatableSection, add it to that section's fields
        if (parentPath.length > 0) {
          const parentRepeatableKey = parentPath[parentPath.length - 1];
          // Find the RepeatableSection by its preferred key
          for (const [dataName, repInfo] of repeatableSectionTree) {
            if (repInfo.preferredKey === parentRepeatableKey) {
              repInfo.fields.set(element.data_name, {
                preferredKey: preferredFieldKey,
                field: element
              });
              break;
            }
          }
        }
      }
    });
  };
  
  // Build the tree structure
  if (Array.isArray(fields)) {
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
    if (preferredKey) {
      form_values[preferredKey] = value;
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
      for (const key of path) {
        current = current[key];
        if (!current) return [];
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
          updated_at: now,
          updated_location: null,
          draft: false,
          created_at: now,
          id: childIds[i] || null,
          form_values: {},
          created_duration: null,
          updated_duration: null,
          created_location: null,
          edited_duration: null,
          version: 1,
          created_by_id: null,
          updated_by_id: null,
          changeset_id: null,
          geometry: null
        };
        
        // Add direct child field values
        for (const [fieldDataName, fieldInfo] of repInfo.fields) {
          const fieldValue = state.values[fieldDataName];
          if (fieldValue !== undefined) {
            // For now, all field values go into the first record
            if (i === 0) {
              childRecord.form_values[fieldInfo.preferredKey] = fieldValue;
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
    status: null,
    version: 1,
    draft: false,
    id: options.mainRecordId || id || null, // Use new options structure, fallback to old id param
    created_at: now,
    updated_at: now,
    client_created_at: now,
    client_updated_at: now,
    
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
    edited_duration: null,
    
    // Form identification
    form_id: null, // To be set by the application
    
    // Form values
    form_values,
    
    // Override any defaults with provided options (excluding our special handling keys)
    ...options,
    
    // Ensure our specific handling isn't overridden
    id: options.mainRecordId || id || null,
    form_values // Ensure form_values isn't overridden
  };

  return record;
} 