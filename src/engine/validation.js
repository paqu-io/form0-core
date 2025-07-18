import { flattenFields } from '../utils/flatten-fields.js';

export function validateFields(schema, values, errors) {
  const fields = flattenFields(schema.elements);

  for (const field of fields) {
    const dataName = field.data_name;
    delete errors[dataName]; // ✅ clear previous error

    const value = values[dataName];
    
    if (field.type === 'TextField' && field.pattern) {
      const re = new RegExp(field.pattern);
      if (!re.test(value)) {
        errors[dataName] = `Invalid format for ${field.data_name}`;
      }
    }
    
    if (field.type === 'NumericField') {
      if (typeof value === 'number') {
        if (field.format === 'integer' && !Number.isInteger(value)) {
          errors[field.data_name] = `${field.data_name} must be an integer`;
        }
        if (field.min !== undefined && value < field.min) {
          errors[field.data_name] = `Must be at least ${field.min}`;
        }
        if (field.max !== undefined && value > field.max) {
          errors[field.data_name] = `Must be at most ${field.max}`;
        }
      }
    }
    
    if (field.type === 'SingleChoiceField') {
      if (value !== null && value !== undefined) {
        // Validate the structure of SingleChoiceField value
        if (typeof value !== 'object' || value === null) {
          errors[field.data_name] = `${field.data_name} must be an object with 'choice' and 'other' arrays`;
          continue;
        }
        
        if (!Array.isArray(value.choice)) {
          errors[field.data_name] = `${field.data_name}.choice must be an array`;
          continue;
        }
        
        if (!Array.isArray(value.other)) {
          errors[field.data_name] = `${field.data_name}.other must be an array`;
          continue;
        }
        
        // Validate choice selections
        const validChoiceValues = new Set(field.choices.map(c => c.value));
        for (const choice of value.choice) {
          if (!choice || typeof choice !== 'object' || !choice.value) {
            errors[field.data_name] = `${field.data_name}.choice must contain objects with 'value' property`;
            break;
          }
          
          if (!validChoiceValues.has(choice.value)) {
            errors[field.data_name] = `${field.data_name}.choice contains invalid value: ${choice.value}`;
            break;
          }
        }
        
        // Validate other selections
        for (const other of value.other) {
          if (!other || typeof other !== 'object' || !other.label) {
            errors[field.data_name] = `${field.data_name}.other must contain objects with 'label' property`;
            break;
          }
        }
        
        // Check if allow_other is false but other array is not empty
        if (!field.allow_other && value.other.length > 0) {
          errors[field.data_name] = `${field.data_name} does not allow 'other' values`;
        }
      }
    }

    if (field.type === 'MultiChoiceField') {
      if (value !== null && value !== undefined) {
        // Validate the structure of MultiChoiceField value
        if (typeof value !== 'object' || value === null) {
          errors[field.data_name] = `${field.data_name} must be an object with 'choices' and 'other' arrays`;
          continue;
        }
        
        if (!Array.isArray(value.choices)) {
          errors[field.data_name] = `${field.data_name}.choices must be an array`;
          continue;
        }
        
        if (!Array.isArray(value.other)) {
          errors[field.data_name] = `${field.data_name}.other must be an array`;
          continue;
        }
        
        // Validate choice selections
        const validChoiceValues = new Set(field.choices.map(c => c.value));
        for (const choice of value.choices) {
          if (!choice || typeof choice !== 'object' || !choice.value) {
            errors[field.data_name] = `${field.data_name}.choices must contain objects with 'value' property`;
            break;
          }
          
          if (!validChoiceValues.has(choice.value)) {
            errors[field.data_name] = `${field.data_name}.choices contains invalid value: ${choice.value}`;
            break;
          }
        }
        
        // Validate other selections
        for (const other of value.other) {
          if (!other || typeof other !== 'object' || !other.label) {
            errors[field.data_name] = `${field.data_name}.other must contain objects with 'label' property`;
            break;
          }
        }
        
        // Check if allow_other is false but other array is not empty
        if (!field.allow_other && value.other.length > 0) {
          errors[field.data_name] = `${field.data_name} does not allow 'other' values`;
        }
      }
    }

    if (field.type === 'BooleanField') {
      if (value !== null && value !== undefined) {
        // Validate the structure of BooleanField value
        if (typeof value !== 'object' || value === null) {
          errors[field.data_name] = `${field.data_name} must be an object with 'choice' array`;
          continue;
        }
        if (!Array.isArray(value.choice)) {
          errors[field.data_name] = `${field.data_name}.choice must be an array`;
          continue;
        }
        // Forbid 'other' array
        if ('other' in value && Array.isArray(value.other) && value.other.length > 0) {
          errors[field.data_name] = `${field.data_name} does not support 'other' values`;
          continue;
        }
        // Validate choice selections
        const validChoiceValues = new Set(field.choices.map(c => c.value));
        for (const choice of value.choice) {
          if (!choice || typeof choice !== 'object' || !choice.value) {
            errors[field.data_name] = `${field.data_name}.choice must contain objects with 'value' property`;
            break;
          }
          if (!validChoiceValues.has(choice.value)) {
            errors[field.data_name] = `${field.data_name}.choice contains invalid value: ${choice.value}`;
            break;
          }
        }
      }
    }

    if (field.type === 'PhotoField') {
      if (value !== null && value !== undefined) {
        if (!Array.isArray(value)) {
          errors[field.data_name] = `${field.data_name} must be an array of photo objects`;
          continue;
        }
        // Validate each photo object (basic check: must be object, optionally with url or file)
        for (const photo of value) {
          if (typeof photo !== 'object' || photo === null) {
            errors[field.data_name] = `${field.data_name} must contain only photo objects`;
            break;
          }
        }
        // Only check min_length/max_length if field has some value
        if (value.length > 0) {
          if (field.min_length !== null && field.min_length !== undefined && value.length < field.min_length) {
            errors[field.data_name] = `${field.data_name} must have at least ${field.min_length} photo(s)`;
          }
          if (field.max_length !== null && field.max_length !== undefined && value.length > field.max_length) {
            errors[field.data_name] = `${field.data_name} must have at most ${field.max_length} photo(s)`;
          }
        }
        // If field is completely empty (length = 0), don't add any validation errors
        // This allows the required validation to take priority
      }
    }

    if (field.type === 'VideoField') {
      if (value !== null && value !== undefined) {
        if (!Array.isArray(value)) {
          errors[field.data_name] = `${field.data_name} must be an array of video objects`;
          continue;
        }

        let totalDuration = 0;
        for (const video of value) {
          if (typeof video !== 'object' || video === null) {
            errors[field.data_name] = `${field.data_name} must contain only video objects`;
            break;
          }
          if (typeof video.duration !== 'number' || video.duration < 0) {
            errors[field.data_name] = `${field.data_name} contains a video with an invalid duration`;
            break;
          }
          totalDuration += video.duration;
        }

        if (errors[field.data_name]) {
          continue; // Stop if there was an error in the loop
        }

        // Only check min_length/max_length if there is at least one video with a valid duration
        if (totalDuration > 0) {
          if (field.min_length !== null && field.min_length !== undefined && totalDuration < (field.min_length * 60)) {
            errors[field.data_name] = `${field.data_name} total duration must be at least ${field.min_length} minute(s)`;
          }
          if (field.max_length !== null && field.max_length !== undefined && totalDuration > (field.max_length * 60)) {
            errors[field.data_name] = `${field.data_name} total duration must be at most ${field.max_length} minute(s)`;
          }
        }
      }
    }
  }
}
