/**
 * Record transformation utilities for form0
 * Creates structured record format for submission with metadata
 */

// /**
//  * Generate UUIDv4 string
//  * @returns {string} UUIDv4 string
//  */
// function generateUUIDv4() {
//   return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
//     const r = Math.random() * 16 | 0;
//     const v = c === 'x' ? r : (r & 0x3 | 0x8);
//     return v.toString(16);
//   });
// }

/**
 * Create structured record from form engine state
 * @param {Object} state - Form engine state {values, errors, visible, required, read_only}
 * @param {Array} [fields] - Optional flattened fields array from schema (for key mapping)
 * @param {Object} options - Additional options for record creation
 * @param {string} [id] - Optional UUID for the record (will generate one if not provided)
 * @returns {Object} Structured record ready for submission
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
  
  // Transform the values object using the preferred keys
  for (const [dataName, value] of Object.entries(state.values)) {
    const preferredKey = dataNameToKeyMap.get(dataName);
    if (preferredKey) {
      form_values[preferredKey] = value;
    } else {
      // Final fallback: keep original data_name if no field mapping found
      form_values[dataName] = value;
    }
  }
  
  // Build structured record with metadata
  const record = {
    status: null,
    version: 1,
    id: id,
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
    
    // Override any defaults with provided options
    ...options
  };

  return record;
} 