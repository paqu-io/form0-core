import { validateChoiceFieldChoices } from '../utilities/field-helpers.js';
import {
  isNonEmptyString,
  validateFormLinkRecordDefaults,
  validateFormLinkRecordConditions,
} from './form-link-validators.js';

/**
 * Central field specification registry
 * Each field type defines its attributes, validation rules, and behavior
 */
export const FIELD_SPECS = {
  TextField: {
    attributes: {
      type: { type: 'string', required: true, nullable: false, value: 'TextField' },
      key: { type: 'string', required: true, nullable: false },
      data_name: { type: 'string', required: true, nullable: false },
      label: { type: 'string', required: true, nullable: false },
      display: { type: 'string', required: true, nullable: false, allowedValues: ['default'] },
      description: {
        type: 'string',
        required: true,
        nullable: true,
        dependentOn: 'description_mode',
      },
      description_mode: {
        type: 'string',
        required: true,
        nullable: true,
        allowedValues: ['default', 'subtext'],
        dependentOn: 'description',
      },
      required: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { required_conditions: (val) => val != null },
      },
      required_conditions: { type: 'object', required: true, nullable: true },
      visible: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { visible_conditions: (val) => val != null },
      },
      visible_conditions: { type: 'object', required: true, nullable: true },
      read_only: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { read_only_conditions: (val) => val != null },
      },
      read_only_conditions: { type: 'object', required: true, nullable: true },
      default_value: { type: 'string', required: true, nullable: true },
      pattern: {
        type: 'string',
        required: true,
        nullable: true,
        dependentOn: 'pattern_description',
      },
      pattern_description: {
        type: 'string',
        required: true,
        nullable: true,
        dependentOn: 'pattern',
      },
      supporting_image: { type: 'boolean', required: true, nullable: false },
      supporting_image_path: { type: 'string', required: true, nullable: true },
      supporting_image_display: {
        type: 'string',
        required: true,
        nullable: true,
        allowedValues: ['default', 'dialog'],
      },
    },
    schemaValidators: [
      // No additional validators needed - all validation handled by attributes
    ],
    valueValidator: (field, value) => {
      if (field.pattern && value !== null && value !== undefined) {
        try {
          const re = new RegExp(field.pattern);
          if (!re.test(value)) {
            return `Invalid format for ${field.data_name}`;
          }
        } catch (e) {
          return `Invalid pattern for ${field.data_name}`;
        }
      }
      return null;
    },
    defaultProducer: (field) => {
      return field.default_value || null;
    },
    outputProducer: (field, value) => {
      // TextField output is just the raw string value
      return value;
    },
  },

  NumericField: {
    attributes: {
      type: { type: 'string', required: true, nullable: false, value: 'NumericField' },
      key: { type: 'string', required: true, nullable: false },
      data_name: { type: 'string', required: true, nullable: false },
      label: { type: 'string', required: true, nullable: false },
      display: { type: 'string', required: true, nullable: false, allowedValues: ['default'] },
      description: { type: 'string', required: true, nullable: true },
      description_mode: {
        type: 'string',
        required: true,
        nullable: true,
        allowedValues: ['default', 'subtext'],
        dependentOn: 'description',
      },
      required: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { required_conditions: (val) => val != null },
      },
      required_conditions: { type: 'object', required: true, nullable: true },
      visible: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { visible_conditions: (val) => val != null },
      },
      visible_conditions: { type: 'object', required: true, nullable: true },
      read_only: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { read_only_conditions: (val) => val != null },
      },
      read_only_conditions: { type: 'object', required: true, nullable: true },
      default_value: { type: 'number', required: true, nullable: true },
      min: { type: 'number', required: true, nullable: true },
      max: { type: 'number', required: true, nullable: true },
      format: {
        type: 'string',
        required: true,
        nullable: false,
        allowedValues: ['integer', 'float'],
      },
      supporting_image: { type: 'boolean', required: true, nullable: false },
      supporting_image_path: { type: 'string', required: true, nullable: true },
      supporting_image_display: {
        type: 'string',
        required: true,
        nullable: true,
        allowedValues: ['default', 'dialog'],
      },
    },
    schemaValidators: [
      // Validate min/max relationship (cross-attribute validation)
      (field) => {
        if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
          return { isValid: false, error: `NumericField "${field.data_name}" has min > max` };
        }
        return { isValid: true };
      },
    ],
    valueValidator: (field, value) => {
      if (typeof value === 'number') {
        if (field.format === 'integer' && !Number.isInteger(value)) {
          return `${field.data_name} must be an integer`;
        }
        if (field.min !== null && field.min !== undefined && value < field.min) {
          return `Must be at least ${field.min}`;
        }
        if (field.max !== null && field.max !== undefined && value > field.max) {
          return `Must be at most ${field.max}`;
        }
      }
      return null;
    },
    defaultProducer: (field) => {
      return field.default_value || null;
    },
    outputProducer: (field, value) => {
      // NumericField output is just the raw numeric value
      return value;
    },
  },

  SingleChoiceField: {
    attributes: {
      type: { type: 'string', required: true, nullable: false, value: 'SingleChoiceField' },
      key: { type: 'string', required: true, nullable: false },
      data_name: { type: 'string', required: true, nullable: false },
      label: { type: 'string', required: true, nullable: false },
      display: {
        type: 'string',
        required: true,
        nullable: false,
        allowedValues: ['default', 'radio'],
      },
      description: { type: 'string', required: true, nullable: true },
      description_mode: {
        type: 'string',
        required: true,
        nullable: true,
        allowedValues: ['default', 'subtext'],
        dependentOn: 'description',
      },
      required: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { required_conditions: (val) => val != null },
      },
      required_conditions: { type: 'object', required: true, nullable: true },
      visible: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { visible_conditions: (val) => val != null },
      },
      visible_conditions: { type: 'object', required: true, nullable: true },
      read_only: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { read_only_conditions: (val) => val != null },
      },
      read_only_conditions: { type: 'object', required: true, nullable: true },
      default_value: { type: 'string', required: true, nullable: true },
      allow_other: { type: 'boolean', required: true, nullable: false },
      choices: { type: 'array', required: true, nullable: false },
      supporting_image: { type: 'boolean', required: true, nullable: false },
      supporting_image_path: { type: 'string', required: true, nullable: true },
      supporting_image_display: {
        type: 'string',
        required: true,
        nullable: true,
        allowedValues: ['default', 'dialog'],
      },
      is_searchable: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { display: 'radio' },
      },
      is_searchable_mode: {
        type: 'string',
        required: true,
        nullable: true,
        allowedValues: ['default'],
        notNullOn: { is_searchable: true },
      },
    },
    schemaValidators: [
      // Validate choices array (cross-attribute validation)
      (field) => {
        if (!Array.isArray(field.choices)) {
          return {
            isValid: false,
            error: `SingleChoiceField "${field.data_name}" must have a 'choice' array`,
          };
        }
        const validation = validateChoiceFieldChoices(field.choices);
        if (!validation.isValid) {
          return {
            isValid: false,
            error: `SingleChoiceField "${field.data_name}" validation failed: ${validation.errors.join(', ')}`,
          };
        }
        return { isValid: true };
      },
    ],
    valueValidator: (field, value) => {
      if (value !== null && value !== undefined) {
        // Validate the structure of SingleChoiceField value
        if (typeof value !== 'object' || value === null) {
          return `${field.data_name} must be an object with 'choice' and 'other' arrays`;
        }

        if (!Array.isArray(value.choice)) {
          return `${field.data_name}.choice must be an array`;
        }

        if (!Array.isArray(value.other)) {
          return `${field.data_name}.other must be an array`;
        }

        // Validate choice selections
        const validChoiceValues = new Set(field.choices.map((c) => c.value));
        for (const choice of value.choice) {
          if (!choice || typeof choice !== 'object' || !choice.value) {
            return `${field.data_name}.choice must contain objects with 'value' property`;
          }

          if (!validChoiceValues.has(choice.value)) {
            return `${field.data_name}.choice contains invalid value: ${choice.value}`;
          }
        }

        // Validate other selections
        for (const other of value.other) {
          if (!other || typeof other !== 'object' || !other.label) {
            return `${field.data_name}.other must contain objects with 'label' property`;
          }
        }

        // Check if allow_other is false but other array is not empty
        if (!field.allow_other && value.other.length > 0) {
          return `${field.data_name} does not allow 'other' values`;
        }
      }
      return null;
    },
    defaultProducer: (field) => {
      if (field.default_value) {
        const choice = field.choices.find((c) => c.value === field.default_value);
        if (choice) {
          return {
            choice: [{ value: choice.value, label: choice.label }],
            other: [],
          };
        }
      }
      return { choice: [], other: [] };
    },
    outputProducer: (field, value) => {
      // SingleChoiceField output structure: {choice_value: [...], other_value: [...]}
      if (value && typeof value === 'object') {
        return {
          choice_value: value.choice || [],
          other_value: value.other || [],
        };
      }
      return { choice_value: [], other_value: [] };
    },
  },

  MultiChoiceField: {
    attributes: {
      type: { type: 'string', required: true, nullable: false, value: 'MultiChoiceField' },
      key: { type: 'string', required: true, nullable: false },
      data_name: { type: 'string', required: true, nullable: false },
      label: { type: 'string', required: true, nullable: false },
      display: {
        type: 'string',
        required: true,
        nullable: false,
        allowedValues: ['default', 'checkbox'],
      },
      description: { type: 'string', required: true, nullable: true },
      description_mode: {
        type: 'string',
        required: true,
        nullable: true,
        allowedValues: ['default', 'subtext'],
        dependentOn: 'description',
      },
      required: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { required_conditions: (val) => val != null },
      },
      required_conditions: { type: 'object', required: true, nullable: true },
      visible: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { visible_conditions: (val) => val != null },
      },
      visible_conditions: { type: 'object', required: true, nullable: true },
      read_only: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { read_only_conditions: (val) => val != null },
      },
      read_only_conditions: { type: 'object', required: true, nullable: true },
      default_value: { type: 'array', required: true, nullable: true },
      allow_other: { type: 'boolean', required: true, nullable: false },
      choices: { type: 'array', required: true, nullable: false },
      supporting_image: { type: 'boolean', required: true, nullable: false },
      supporting_image_path: { type: 'string', required: true, nullable: true },
      supporting_image_display: {
        type: 'string',
        required: true,
        nullable: true,
        allowedValues: ['default', 'dialog'],
      },
      is_searchable: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { display: 'checkbox' },
      },
      is_searchable_mode: {
        type: 'string',
        required: true,
        nullable: true,
        allowedValues: ['default'],
        notNullOn: { is_searchable: true },
      },
    },
    schemaValidators: [
      // Validate choices array (cross-attribute validation)
      (field) => {
        if (!Array.isArray(field.choices)) {
          return {
            isValid: false,
            error: `MultiChoiceField "${field.data_name}" must have a 'choices' array`,
          };
        }
        const validation = validateChoiceFieldChoices(field.choices);
        if (!validation.isValid) {
          return {
            isValid: false,
            error: `MultiChoiceField "${field.data_name}" validation failed: ${validation.errors.join(', ')}`,
          };
        }
        return { isValid: true };
      },
    ],
    valueValidator: (field, value) => {
      if (value !== null && value !== undefined) {
        // Validate the structure of MultiChoiceField value
        if (typeof value !== 'object' || value === null) {
          return `${field.data_name} must be an object with 'choices' and 'other' arrays`;
        }

        if (!Array.isArray(value.choices)) {
          return `${field.data_name}.choices must be an array`;
        }

        if (!Array.isArray(value.other)) {
          return `${field.data_name}.other must be an array`;
        }

        // Validate choice selections
        const validChoiceValues = new Set(field.choices.map((c) => c.value));
        for (const choice of value.choices) {
          if (!choice || typeof choice !== 'object' || !choice.value) {
            return `${field.data_name}.choices must contain objects with 'value' property`;
          }

          if (!validChoiceValues.has(choice.value)) {
            return `${field.data_name}.choices contains invalid value: ${choice.value}`;
          }
        }

        // Validate other selections
        for (const other of value.other) {
          if (!other || typeof other !== 'object' || !other.label) {
            return `${field.data_name}.other must contain objects with 'label' property`;
          }
        }

        // Check if allow_other is false but other array is not empty
        if (!field.allow_other && value.other.length > 0) {
          return `${field.data_name} does not allow 'other' values`;
        }
      }
      return null;
    },
    defaultProducer: (field) => {
      if (field.default_value) {
        const selectedChoices = field.choices
          .filter((c) => field.default_value.includes(c.value))
          .map((c) => ({ value: c.value, label: c.label }));
        return {
          choices: selectedChoices,
          other: [],
        };
      }
      return { choices: [], other: [] };
    },
    outputProducer: (field, value) => {
      // MultiChoiceField output structure: {choices_value: [...], other_value: [...]}
      if (value && typeof value === 'object') {
        return {
          choices_value: value.choices || [],
          other_value: value.other || [],
        };
      }
      return { choices_value: [], other_value: [] };
    },
  },

  BooleanField: {
    attributes: {
      type: { type: 'string', required: true, nullable: false, value: 'BooleanField' },
      key: { type: 'string', required: true, nullable: false },
      data_name: { type: 'string', required: true, nullable: false },
      label: { type: 'string', required: true, nullable: false },
      display: { type: 'string', required: true, nullable: false, allowedValues: ['default'] },
      description: { type: 'string', required: true, nullable: true },
      description_mode: {
        type: 'string',
        required: true,
        nullable: true,
        allowedValues: ['default', 'subtext'],
        dependentOn: 'description',
      },
      required: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { required_conditions: (val) => val != null },
      },
      required_conditions: { type: 'object', required: true, nullable: true },
      visible: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { visible_conditions: (val) => val != null },
      },
      visible_conditions: { type: 'object', required: true, nullable: true },
      read_only: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { read_only_conditions: (val) => val != null },
      },
      read_only_conditions: { type: 'object', required: true, nullable: true },
      default_value: { type: 'string', required: true, nullable: true },
      choices: { type: 'array', required: true, nullable: false },
      third_option_enabled: { type: 'boolean', required: true, nullable: false },
      supporting_image: { type: 'boolean', required: true, nullable: false },
      supporting_image_path: { type: 'string', required: true, nullable: true },
      supporting_image_display: {
        type: 'string',
        required: true,
        nullable: true,
        allowedValues: ['default', 'dialog'],
      },
    },
    schemaValidators: [
      // Validate choices array and third_option_enabled relationship (cross-attribute validation)
      (field) => {
        if (!Array.isArray(field.choices)) {
          return {
            isValid: false,
            error: `BooleanField "${field.data_name}" must have a 'choices' array`,
          };
        }
        const validation = validateChoiceFieldChoices(field.choices);
        if (!validation.isValid) {
          return {
            isValid: false,
            error: `BooleanField "${field.data_name}" validation failed: ${validation.errors.join(', ')}`,
          };
        }
        // Check number of choices
        const thirdOption = field.third_option_enabled === true;
        if (thirdOption && field.choices.length !== 3) {
          return {
            isValid: false,
            error: `BooleanField "${field.data_name}" must have exactly 3 choices when third_option_enabled is true`,
          };
        } else if (!thirdOption && field.choices.length !== 2) {
          return {
            isValid: false,
            error: `BooleanField "${field.data_name}" must have exactly 2 choices when third_option_enabled is false or missing`,
          };
        }
        return { isValid: true };
      },
    ],
    valueValidator: (field, value) => {
      if (value !== null && value !== undefined) {
        // Validate the structure of BooleanField value
        if (typeof value !== 'object' || value === null) {
          return `${field.data_name} must be an object with 'choice' array`;
        }
        if (!Array.isArray(value.choice)) {
          return `${field.data_name}.choice must be an array`;
        }
        // Forbid 'other' array
        if ('other' in value && Array.isArray(value.other) && value.other.length > 0) {
          return `${field.data_name} does not support 'other' values`;
        }
        // Validate choice selections
        const validChoiceValues = new Set(field.choices.map((c) => c.value));
        for (const choice of value.choice) {
          if (!choice || typeof choice !== 'object' || !choice.value) {
            return `${field.data_name}.choice must contain objects with 'value' property`;
          }
          if (!validChoiceValues.has(choice.value)) {
            return `${field.data_name}.choice contains invalid value: ${choice.value}`;
          }
        }
      }
      return null;
    },
    defaultProducer: (field) => {
      if (field.default_value) {
        const choice = field.choices.find((c) => c.value === field.default_value);
        if (choice) {
          return {
            choice: [{ value: choice.value, label: choice.label }],
            other: [],
          };
        }
      }
      return { choice: [], other: [] };
    },
    outputProducer: (field, value) => {
      // BooleanField output structure: {choice_value: [...], other_value: [...]}
      if (value && typeof value === 'object') {
        return {
          choice_value: value.choice || [],
          other_value: [], // BooleanField doesn't support other values
        };
      }
      return { choice_value: [], other_value: [] };
    },
  },

  DateField: {
    attributes: {
      type: { type: 'string', required: true, nullable: false, value: 'DateField' },
      key: { type: 'string', required: true, nullable: false },
      data_name: { type: 'string', required: true, nullable: false },
      label: { type: 'string', required: true, nullable: false },
      display: { type: 'string', required: true, nullable: false, allowedValues: ['default'] },
      description: { type: 'string', required: true, nullable: true },
      description_mode: {
        type: 'string',
        required: true,
        nullable: true,
        allowedValues: ['default', 'subtext'],
        dependentOn: 'description',
      },
      required: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { required_conditions: (val) => val != null },
      },
      required_conditions: { type: 'object', required: true, nullable: true },
      visible: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { visible_conditions: (val) => val != null },
      },
      visible_conditions: { type: 'object', required: true, nullable: true },
      read_only: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { read_only_conditions: (val) => val != null },
      },
      read_only_conditions: { type: 'object', required: true, nullable: true },
      default_value: { type: 'string', required: true, nullable: true, allowedValues: ['now'] },
    },
    schemaValidators: [
      // No additional validators needed - all validation handled by attributes
    ],
    valueValidator: (field, value) => {
      return null; // DateField has no runtime validation
    },
    defaultProducer: (field) => {
      if (field.default_value === 'now') {
        const today = new Date();
        return today.toISOString().split('T')[0]; // YYYY-MM-DD format
      }
      return null;
    },
    outputProducer: (field, value) => {
      // DateField output is just the raw date string (YYYY-MM-DD)
      return value;
    },
  },

  TimeField: {
    attributes: {
      type: { type: 'string', required: true, nullable: false, value: 'TimeField' },
      key: { type: 'string', required: true, nullable: false },
      data_name: { type: 'string', required: true, nullable: false },
      label: { type: 'string', required: true, nullable: false },
      display: { type: 'string', required: true, nullable: false, allowedValues: ['default'] },
      description: { type: 'string', required: true, nullable: true },
      description_mode: {
        type: 'string',
        required: true,
        nullable: true,
        allowedValues: ['default', 'subtext'],
        dependentOn: 'description',
      },
      required: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { required_conditions: (val) => val != null },
      },
      required_conditions: { type: 'object', required: true, nullable: true },
      visible: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { visible_conditions: (val) => val != null },
      },
      visible_conditions: { type: 'object', required: true, nullable: true },
      read_only: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { read_only_conditions: (val) => val != null },
      },
      read_only_conditions: { type: 'object', required: true, nullable: true },
      default_value: { type: 'string', required: true, nullable: true, allowedValues: ['now'] },
    },
    schemaValidators: [
      // No additional validators needed - all validation handled by attributes
    ],
    valueValidator: (field, value) => {
      return null; // TimeField has no runtime validation
    },
    defaultProducer: (field) => {
      if (field.default_value === 'now') {
        const now = new Date();
        return now.toTimeString().split(' ')[0]; // HH:MM:SS format
      }
      return null;
    },
    outputProducer: (field, value) => {
      // TimeField output is just the raw time string (HH:MM:SS)
      return value;
    },
  },

  CalculatedField: {
    attributes: {
      type: { type: 'string', required: true, nullable: false, value: 'CalculatedField' },
      key: { type: 'string', required: true, nullable: false },
      data_name: { type: 'string', required: true, nullable: false },
      label: { type: 'string', required: true, nullable: false },
      display: { type: 'object', required: true, nullable: false },
      description: { type: 'string', required: true, nullable: true },
      description_mode: {
        type: 'string',
        required: true,
        nullable: true,
        allowedValues: ['default', 'subtext'],
        dependentOn: 'description',
      },
      required: { type: 'boolean', required: true, nullable: false, value: false },
      visible: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { visible_conditions: (val) => val != null },
      },
      visible_conditions: { type: 'object', required: true, nullable: true },
      read_only: { type: 'boolean', required: true, nullable: false, value: true },
      calculate: { type: 'string', required: true, nullable: false },
      supporting_image: { type: 'boolean', required: true, nullable: false },
      supporting_image_path: { type: 'string', required: true, nullable: true },
      supporting_image_display: {
        type: 'string',
        required: true,
        nullable: true,
        allowedValues: ['default', 'dialog'],
      },
    },
    schemaValidators: [
      // Validate display.style (cross-attribute validation)
      (field) => {
        if (field.display && field.display.style) {
          const allowed = ['text', 'numeric', 'date', 'currency'];
          if (!allowed.includes(field.display.style)) {
            return {
              isValid: false,
              error: `Invalid display.style "${field.display.style}" for ${field.data_name}`,
            };
          }
        }
        return { isValid: true };
      },
    ],
    valueValidator: (field, value) => {
      return null; // CalculatedField has no runtime validation
    },
    defaultProducer: (field) => {
      return null; // Calculated fields don't have user input
    },
    outputProducer: (field, value) => {
      // CalculatedField output is just the calculated value
      return value;
    },
  },

  Section: {
    attributes: {
      type: { type: 'string', required: true, nullable: false, value: 'Section' },
      key: { type: 'string', required: true, nullable: false },
      data_name: { type: 'string', required: true, nullable: false },
      label: { type: 'string', required: true, nullable: false },
      display: {
        type: 'string',
        required: true,
        nullable: false,
        allowedValues: ['inline', 'drilldown'],
      },
      description: { type: 'string', required: true, nullable: true },
      description_mode: {
        type: 'string',
        required: true,
        nullable: true,
        allowedValues: ['default', 'subtext'],
        dependentOn: 'description',
      },
      visible: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { visible_conditions: (val) => val != null },
      },
      visible_conditions: { type: 'object', required: true, nullable: true },
      elements: { type: 'array', required: true, nullable: false },
    },
    schemaValidators: [
      // Validate elements array (cross-attribute validation)
      (field) => {
        if (!Array.isArray(field.elements) || field.elements.length === 0) {
          return {
            isValid: false,
            error: `Section \"${field.data_name}\" must contain at least one element`,
          };
        }
        return { isValid: true };
      },
    ],
    valueValidator: (field, value) => {
      return null; // Section has no runtime validation
    },
    defaultProducer: (field) => {
      return null; // Section doesn't support default values
    },
    outputProducer: (field, value) => {
      // Section has no output value (organizational container only)
      return null;
    },
  },

  RepeatableSection: {
    attributes: {
      type: { type: 'string', required: true, nullable: false, value: 'RepeatableSection' },
      key: { type: 'string', required: true, nullable: false },
      data_name: { type: 'string', required: true, nullable: false },
      label: { type: 'string', required: true, nullable: false },
      display: { type: 'string', required: true, nullable: false, allowedValues: ['drilldown'] },
      description: { type: 'string', required: true, nullable: true },
      description_mode: {
        type: 'string',
        required: true,
        nullable: true,
        allowedValues: ['default', 'subtext'],
        dependentOn: 'description',
      },
      visible: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { visible_conditions: (val) => val != null },
      },
      visible_conditions: { type: 'object', required: true, nullable: true },
      location_enabled: { type: 'boolean', required: true, nullable: false },
      location_required: { type: 'boolean', required: true, nullable: false },
      elements: { type: 'array', required: true, nullable: false },
    },
    schemaValidators: [
      // Validate elements array (cross-attribute validation)
      (field) => {
        if (!Array.isArray(field.elements) || field.elements.length === 0) {
          return {
            isValid: false,
            error: `RepeatableSection \"${field.data_name}\" must contain at least one element`,
          };
        }
        return { isValid: true };
      },
    ],
    valueValidator: (field, value) => {
      return null; // RepeatableSection has no runtime validation
    },
    defaultProducer: (field) => {
      return null; // RepeatableSection doesn't support default values
    },
    outputProducer: (field, value) => {
      // RepeatableSection has no output value (organizational container only)
      return null;
    },
  },

  LabelField: {
    attributes: {
      type: { type: 'string', required: true, nullable: false, value: 'LabelField' },
      key: { type: 'string', required: true, nullable: false },
      data_name: { type: 'string', required: true, nullable: false },
      label: { type: 'string', required: true, nullable: false },
      display: { type: 'string', required: true, nullable: false, allowedValues: ['default'] },
      description: { type: 'string', required: true, nullable: true },
      description_mode: {
        type: 'string',
        required: true,
        nullable: true,
        allowedValues: ['default', 'subtext'],
        dependentOn: 'description',
      },
      required: { type: 'boolean', required: true, nullable: false, value: false },
      visible: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { visible_conditions: (val) => val != null },
      },
      visible_conditions: { type: 'object', required: true, nullable: true },
      read_only: { type: 'boolean', required: true, nullable: false, value: true },
      default_value: { type: 'string', required: true, nullable: true, value: null },
      supporting_image: { type: 'boolean', required: true, nullable: false },
      supporting_image_path: { type: 'string', required: true, nullable: true },
      supporting_image_display: {
        type: 'string',
        required: true,
        nullable: true,
        allowedValues: ['default', 'dialog'],
      },
    },
    schemaValidators: [
      // No additional validators needed - all validation handled by attributes
    ],
    valueValidator: (field, value) => {
      return null; // LabelField has no runtime validation
    },
    defaultProducer: (field) => {
      return null; // LabelField doesn't support default values
    },
    outputProducer: (field, value) => {
      // LabelField has no output value (display only)
      return null;
    },
  },

  SignatureField: {
    attributes: {
      type: { type: 'string', required: true, nullable: false, value: 'SignatureField' },
      key: { type: 'string', required: true, nullable: false },
      data_name: { type: 'string', required: true, nullable: false },
      label: { type: 'string', required: true, nullable: false },
      display: { type: 'string', required: true, nullable: false, allowedValues: ['default'] },
      description: { type: 'string', required: true, nullable: true },
      description_mode: {
        type: 'string',
        required: true,
        nullable: true,
        allowedValues: ['default', 'subtext'],
        dependentOn: 'description',
      },
      required: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { required_conditions: (val) => val != null },
      },
      required_conditions: { type: 'object', required: true, nullable: true },
      visible: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { visible_conditions: (val) => val != null },
      },
      visible_conditions: { type: 'object', required: true, nullable: true },
      read_only: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { read_only_conditions: (val) => val != null },
      },
      read_only_conditions: { type: 'object', required: true, nullable: true },
      default_value: { type: 'string', required: true, nullable: true, value: null },
      agreement_text: { type: 'string', required: true, nullable: true },
    },
    schemaValidators: [
      // No additional validators needed - all validation handled by attributes
    ],
    valueValidator: (field, value) => {
      return null; // SignatureField has no runtime validation
    },
    defaultProducer: (field) => {
      return field.default_value || null;
    },
    outputProducer: (field, value) => {
      // SignatureField output structure: {signature_id: null, data: base64String}
      if (value && typeof value === 'object' && value.data) {
        // Value is already in the correct structure from form-renderer.js
        return {
          signature_id: value.signature_id || null,
          data: value.data,
        };
      } else if (value && typeof value === 'string') {
        // Fallback: if value is just the base64 string
        return {
          signature_id: null,
          data: value,
        };
      }
      return null;
    },
  },

  PhotoField: {
    attributes: {
      type: { type: 'string', required: true, nullable: false, value: 'PhotoField' },
      key: { type: 'string', required: true, nullable: false },
      data_name: { type: 'string', required: true, nullable: false },
      label: { type: 'string', required: true, nullable: false },
      display: { type: 'string', required: true, nullable: false, allowedValues: ['default'] },
      description: { type: 'string', required: true, nullable: true },
      description_mode: {
        type: 'string',
        required: true,
        nullable: true,
        allowedValues: ['default', 'subtext'],
        dependentOn: 'description',
      },
      required: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { required_conditions: (val) => val != null },
      },
      required_conditions: { type: 'object', required: true, nullable: true },
      visible: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { visible_conditions: (val) => val != null },
      },
      visible_conditions: { type: 'object', required: true, nullable: true },
      read_only: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { read_only_conditions: (val) => val != null },
      },
      read_only_conditions: { type: 'object', required: true, nullable: true },
      default_value: { type: 'null', required: true, nullable: true, value: null },
      min_length: { type: 'number', required: true, nullable: true },
      max_length: { type: 'number', required: true, nullable: true },
    },
    schemaValidators: [
      // No additional validators needed - all validation handled by attributes
    ],
    valueValidator: (field, value) => {
      if (value !== null && value !== undefined) {
        if (!Array.isArray(value)) {
          return `${field.data_name} must be an array of photo objects`;
        }
        // Validate each photo object (basic check: must be object, optionally with url or file)
        for (const photo of value) {
          if (typeof photo !== 'object' || photo === null) {
            return `${field.data_name} must contain only photo objects`;
          }
        }
        // Only check min_length/max_length if field has some value
        if (value.length > 0) {
          if (
            field.min_length !== null &&
            field.min_length !== undefined &&
            value.length < field.min_length
          ) {
            return `${field.data_name} must have at least ${field.min_length} photo(s)`;
          }
          if (
            field.max_length !== null &&
            field.max_length !== undefined &&
            value.length > field.max_length
          ) {
            return `${field.data_name} must have at most ${field.max_length} photo(s)`;
          }
        }
      }
      return null;
    },
    defaultProducer: (field) => {
      return null; // PhotoField default_value must be null
    },
    outputProducer: (field, value) => {
      // PhotoField output structure: array of {photo_id: null|uuid, filename: string, caption: string|null}
      if (Array.isArray(value)) {
        return value.map((photo) => ({
          photo_id: photo.photo_id || null,
          filename: photo.filename || photo.name || 'unknown',
          caption: photo.caption || null,
        }));
      }
      return [];
    },
  },

  VideoField: {
    attributes: {
      type: { type: 'string', required: true, nullable: false, value: 'VideoField' },
      key: { type: 'string', required: true, nullable: false },
      data_name: { type: 'string', required: true, nullable: false },
      label: { type: 'string', required: true, nullable: false },
      display: { type: 'string', required: true, nullable: false, allowedValues: ['default'] },
      description: { type: 'string', required: true, nullable: true },
      description_mode: {
        type: 'string',
        required: true,
        nullable: true,
        allowedValues: ['default', 'subtext'],
        dependentOn: 'description',
      },
      required: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { required_conditions: (val) => val != null },
      },
      required_conditions: { type: 'object', required: true, nullable: true },
      visible: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { visible_conditions: (val) => val != null },
      },
      visible_conditions: { type: 'object', required: true, nullable: true },
      read_only: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { read_only_conditions: (val) => val != null },
      },
      read_only_conditions: { type: 'object', required: true, nullable: true },
      default_value: { type: 'null', required: true, nullable: true, value: null },
      min_length: { type: 'number', required: true, nullable: true },
      max_length: { type: 'number', required: true, nullable: true },
    },
    schemaValidators: [
      // No additional validators needed - all validation handled by attributes
    ],
    valueValidator: (field, value) => {
      if (value !== null && value !== undefined) {
        if (!Array.isArray(value)) {
          return `${field.data_name} must be an array of video objects`;
        }

        let totalDuration = 0;
        for (const video of value) {
          if (typeof video !== 'object' || video === null) {
            return `${field.data_name} must contain only video objects`;
          }
          if (typeof video.duration !== 'number' || video.duration < 0) {
            return `${field.data_name} contains a video with an invalid duration`;
          }
          totalDuration += video.duration;
        }

        // Only check min_length/max_length if there is at least one video with a valid duration
        if (totalDuration > 0) {
          if (
            field.min_length !== null &&
            field.min_length !== undefined &&
            totalDuration < field.min_length * 60
          ) {
            return `${field.data_name} total duration must be at least ${field.min_length} minute(s)`;
          }
          if (
            field.max_length !== null &&
            field.max_length !== undefined &&
            totalDuration > field.max_length * 60
          ) {
            return `${field.data_name} total duration must be at most ${field.max_length} minute(s)`;
          }
        }
      }
      return null;
    },
    defaultProducer: (field) => {
      return null; // VideoField default_value must be null
    },
    outputProducer: (field, value) => {
      // VideoField output structure: array of {video_id: null|uuid, filename: string, duration: number, caption: string|null}
      if (Array.isArray(value)) {
        return value.map((video) => ({
          video_id: video.video_id || null,
          filename: video.filename || video.name || 'unknown',
          duration: video.duration || 0,
          caption: video.caption || null,
        }));
      }
      return [];
    },
  },

  FormLinkField: {
    attributes: {
      type: { type: 'string', required: true, nullable: false, value: 'FormLinkField' },
      key: { type: 'string', required: true, nullable: false },
      data_name: { type: 'string', required: true, nullable: false },
      label: { type: 'string', required: true, nullable: false },
      display: { type: 'string', required: true, nullable: false, allowedValues: ['default'] },
      description: {
        type: 'string',
        required: true,
        nullable: true,
        dependentOn: 'description_mode',
      },
      description_mode: {
        type: 'string',
        required: true,
        nullable: true,
        allowedValues: ['default', 'subtext'],
        dependentOn: 'description',
      },
      required: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { required_conditions: (val) => val != null },
      },
      required_conditions: { type: 'object', required: true, nullable: true },
      visible: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { visible_conditions: (val) => val != null },
      },
      visible_conditions: { type: 'object', required: true, nullable: true },
      read_only: {
        type: 'boolean',
        required: true,
        nullable: false,
        notTrueOn: { read_only_conditions: (val) => val != null },
      },
      read_only_conditions: { type: 'object', required: true, nullable: true },
      default_value: { type: 'null', required: true, nullable: true },
      allow_creating_records: { type: 'boolean', required: true, nullable: false },
      allow_existing_records: { type: 'boolean', required: true, nullable: false },
      allow_updating_records: { type: 'boolean', required: true, nullable: false },
      allow_multiple_records: { type: 'boolean', required: true, nullable: false },
      form_id: { type: 'string', required: true, nullable: false },
      record_conditions: { type: 'object', required: true, nullable: true },
      record_defaults: { type: 'array', required: true, nullable: true },
    },
    schemaValidators: [
      (field) => {
        if (!isNonEmptyString(field.form_id)) {
          return {
            isValid: false,
            error: `FormLinkField "${field.data_name}" form_id must be a non-empty string`,
          };
        }

        if (field.default_value !== null && field.default_value !== undefined) {
          return {
            isValid: false,
            error: `FormLinkField "${field.data_name}" default_value must be null`,
          };
        }

        if (field.allow_creating_records !== true && field.allow_existing_records !== true) {
          return {
            isValid: false,
            error: `FormLinkField "${field.data_name}" must enable either allow_creating_records or allow_existing_records`,
          };
        }

        const defaultsValidation = validateFormLinkRecordDefaults(field);
        if (!defaultsValidation.isValid) {
          return defaultsValidation;
        }

        const conditionsValidation = validateFormLinkRecordConditions(field);
        if (!conditionsValidation.isValid) {
          return conditionsValidation;
        }

        return { isValid: true };
      },
    ],
    valueValidator: (field, value) => {
      if (value == null) {
        return null;
      }

      if (!Array.isArray(value)) {
        return `${field.data_name} must be an array of linked record references`;
      }

      if (field.allow_multiple_records !== true && value.length > 1) {
        return `${field.data_name} allows only a single linked record`;
      }

      for (let index = 0; index < value.length; index += 1) {
        const entry = value[index];
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return `${field.data_name}[${index}] must be an object`;
        }
        if (!isNonEmptyString(entry.record_id)) {
          return `${field.data_name}[${index}].record_id must be a non-empty string`;
        }
      }

      return null;
    },
    defaultProducer: () => {
      return [];
    },
    outputProducer: (field, value) => {
      if (!Array.isArray(value)) {
        return [];
      }

      return value
        .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
        .map((entry) => ({ record_id: entry.record_id }))
        .filter((entry) => isNonEmptyString(entry.record_id));
    },
  },

  StatusField: {
    attributes: {
      type: { type: 'string', required: true, nullable: false, value: 'StatusField' },
      key: { type: 'string', required: true, nullable: false, value: '@status' },
      data_name: { type: 'string', required: true, nullable: false, value: 'status' },
      label: { type: 'string', required: true, nullable: false },
      display: { type: 'string', required: true, nullable: false, value: 'default' },
      enabled: { type: 'boolean', required: true, nullable: false },
      visible: { type: 'boolean', required: true, nullable: false },
      visible_conditions: { type: 'object', required: true, nullable: true },
      read_only: { type: 'boolean', required: true, nullable: false },
      read_only_conditions: { type: 'object', required: true, nullable: true },
      default_value: { type: 'string', required: true, nullable: true },
      choices: { type: 'array', required: true, nullable: false },
    },
    schemaValidators: [
      (field) => {
        // Validate choices array
        if (!Array.isArray(field.choices) || field.choices.length === 0) {
          return {
            isValid: false,
            error: `StatusField "${field.data_name}" must have a non-empty 'choices' array`,
          };
        }
        const hexColorRegex = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
        const baseValidation = validateChoiceFieldChoices(field.choices);
        if (!baseValidation.isValid) {
          return {
            isValid: false,
            error: `StatusField "${field.data_name}" validation failed: ${baseValidation.errors.join(', ')}`,
          };
        }
        for (let i = 0; i < field.choices.length; i++) {
          const c = field.choices[i];
          if (!c.color || typeof c.color !== 'string' || !hexColorRegex.test(c.color)) {
            return {
              isValid: false,
              error: `StatusField "${field.data_name}" choice at index ${i} must include a valid hex 'color'`,
            };
          }
        }
        return { isValid: true };
      },
    ],
    valueValidator: (field, value) => {
      // Runtime value (when provided) must be one of the choice values
      if (value !== null && value !== undefined) {
        const allowed = new Set((field.choices || []).map((c) => c.value));
        if (typeof value !== 'string' || !allowed.has(value)) {
          return `${field.data_name} must be one of the allowed status values`;
        }
      }
      return null;
    },
    defaultProducer: (field) => {
      return field.default_value || null;
    },
    outputProducer: (field, value) => {
      // Output is the selected status value string
      return value == null ? null : value;
    },
  },

  TitleField: {
    attributes: {
      type: { type: 'string', required: true, nullable: false, value: 'TitleField' },
      key: { type: 'string', required: true, nullable: false, value: '@title' },
      data_name: { type: 'string', required: true, nullable: false, value: 'title' },
      label: { type: 'string', required: true, nullable: false },
      display: { type: 'string', required: true, nullable: false, value: 'default' },
      enabled: { type: 'boolean', required: true, nullable: false, value: true },
      visible: { type: 'boolean', required: true, nullable: false, value: true },
      visible_conditions: { type: 'object', required: true, nullable: true },
      read_only: { type: 'boolean', required: true, nullable: false, value: true },
      read_only_conditions: { type: 'object', required: true, nullable: true },
      elements: { type: 'array', required: true, nullable: false },
    },
    schemaValidators: [
      (field) => {
        if (!Array.isArray(field.elements) || field.elements.length === 0) {
          return {
            isValid: false,
            error: `TitleField "${field.data_name}" must contain a non-empty elements array`,
          };
        }
        // Elements should be strings (keys or data_names)
        for (let i = 0; i < field.elements.length; i++) {
          const ref = field.elements[i];
          if (typeof ref !== 'string') {
            return {
              isValid: false,
              error: `TitleField elements must be strings (key or data_name). Invalid at index ${i}`,
            };
          }
        }
        return { isValid: true };
      },
    ],
    valueValidator: (field, value) => {
      // Title is derived; no user-provided runtime value
      return null;
    },
    defaultProducer: () => null,
    outputProducer: (field, value) => {
      // Output is the final string title if provided
      return value == null ? null : String(value);
    },
  },
};
