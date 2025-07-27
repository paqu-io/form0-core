import { evaluateCalculatedFields } from './calculation.js';
import { evaluateVisibility } from './conditions.js';
import { evaluateRequirement } from './conditions.js';
import { evaluateReadOnly } from './conditions.js';
import { validateFields } from './field-validation.js';
import { builtins, eventBuiltins } from '../builtins/registry.js';
import { validateSchema } from '../schema/schema-validator.js';
import { flattenFields } from '../utilities/field-helpers.js';
import { DEFAULT_SECURITY_CONFIG } from '../security/config.js';
import { EventManager } from './events.js';
import { FIELD_SPECS } from '../schema/field-specs.js';


export function createFormEngine({ 
  schema, 
  initialValues = {}, 
  helpers = {},
  security = DEFAULT_SECURITY_CONFIG 
}) {
  validateSchema(schema.form);

  const { form } = schema;
  const values = { ...initialValues };
  const allFields = flattenFields(form.elements);
  
  // Create a lookup map for choice fields
  const choiceFieldMap = new Map();
  for (const field of allFields) {
    if (field.type === 'SingleChoiceField' || field.type === 'MultiChoiceField' || field.type === 'BooleanField') {
      const valueToLabelMap = new Map();
      field.choices.forEach(choice => {
        valueToLabelMap.set(choice.value, choice.label);
      });
      choiceFieldMap.set(field.data_name, valueToLabelMap);
    }
  }
  
  for (const field of allFields) {
    if (!(field.data_name in values)) {
      // Initialize field with default value if specified
      values[field.data_name] = getDefaultValue(field);
    } else if (field.type === 'SingleChoiceField' || field.type === 'BooleanField') {
      // Enrich SingleChoiceField and BooleanField values with labels from schema
      const fieldValue = values[field.data_name];
      if (fieldValue && typeof fieldValue === 'object' && Array.isArray(fieldValue.choice)) {
        const labelMap = choiceFieldMap.get(field.data_name);
        fieldValue.choice = fieldValue.choice.map(choice => {
          if (choice && choice.value && !choice.label) {
            // Auto-populate label from schema
            const label = labelMap.get(choice.value);
            return {
              ...choice,
              label: label || choice.value // fallback to value if label not found
            };
          }
          return choice;
        });
      }
    } else if (field.type === 'MultiChoiceField') {
      // Enrich MultiChoiceField values with labels from schema
      const fieldValue = values[field.data_name];
      if (fieldValue && typeof fieldValue === 'object' && Array.isArray(fieldValue.choices)) {
        const labelMap = choiceFieldMap.get(field.data_name);
        fieldValue.choices = fieldValue.choices.map(choice => {
          if (choice && choice.value && !choice.label) {
            // Auto-populate label from schema
            const label = labelMap.get(choice.value);
            return {
              ...choice,
              label: label || choice.value // fallback to value if label not found
            };
          }
          return choice;
        });
      }
    }
  }
  const errors = {};
  const visible = {};
  const required = {};
  const read_only = {};

  const allHelpers = { ...builtins, ...helpers };
  
  // Initialize event system
  const eventManager = new EventManager();
  eventManager.securityConfig = security; // Pass security config
  const eventHelpers = { ...builtins, ...eventBuiltins, ...helpers };
  
  // Initialize event code if present
  if (schema.form.events && schema.form.events.code) {
    const eventContext = buildEventContext(values, eventHelpers, {});
    eventManager.initializeEventCode(schema.form.events.code, eventContext);
  }
  
  function buildEventContext(values, helpers, eventMeta) {
    const ctx = {};
    
    // Add field values with $ prefix
    for (const key in values) {
      ctx[`$${key}`] = values[key];
    }
    
    // Add helpers and event-specific builtins
    // TODO: Add form/record metadata builtins (THIS, ALTITUDE, etc.)
    return { ...ctx, ...helpers };
  }

  function evalForm() {
    evaluateCalculatedFields(form, values, allHelpers, security);
    evaluateRequirement(form, values, required);
    evaluateVisibility(form, values, visible);
    evaluateReadOnly(form, values, read_only);
    validateFields(form, values, errors);
  }

  function trigger(eventType, fieldKey, metadata = {}) {
    // Update event context with current values
    const eventContext = buildEventContext(values, eventHelpers, { eventType, fieldKey, ...metadata });
    return eventManager.trigger(eventType, fieldKey, metadata);
  }

  function getState() {
    return { values, errors, visible, required, read_only };
  }

  return {
    eval: evalForm,
    trigger,
    getState,
  };
}

function getDefaultValue(field) {
  const spec = FIELD_SPECS[field.type];
  if (spec && spec.defaultProducer) {
    return spec.defaultProducer(field);
  }
  
  // Fallback to existing logic for safety
  return getDefaultValueLegacy(field);
}

function getDefaultValueLegacy(field) {
  if (field.default_value === null || field.default_value === undefined) {
    // Return appropriate default structure for each field type
    switch (field.type) {
      case 'SingleChoiceField':
      case 'BooleanField':
        return { choice: [], other: [] };
      case 'MultiChoiceField':
        return { choices: [], other: [] };
      case 'CalculatedField':
        return null; // Calculated fields don't have user input
      default:
        return null;
    }
  }

  switch (field.type) {
    case 'TextField':
      return field.default_value;
      
    case 'NumericField':
      return field.default_value;
      
    case 'SingleChoiceField':
    case 'BooleanField':
      // For SingleChoiceField and BooleanField, we need to find the choice and create the proper structure
      const choice = field.choices.find(c => c.value === field.default_value);
      if (choice) {
        return {
          choice: [{ value: choice.value, label: choice.label }],
          other: []
        };
      }
      return { choice: [], other: [] };
      
    case 'MultiChoiceField':
      // For MultiChoiceField, we need to find all choices and create the proper structure
      const selectedChoices = field.choices
        .filter(c => field.default_value.includes(c.value))
        .map(c => ({ value: c.value, label: c.label }));
      return {
        choices: selectedChoices,
        other: []
      };
      
    case 'DateField':
      if (field.default_value === 'now') {
        const today = new Date();
        return today.toISOString().split('T')[0]; // YYYY-MM-DD format
      }
      return null;
      
    case 'TimeField':
      if (field.default_value === 'now') {
        const now = new Date();
        return now.toTimeString().split(' ')[0]; // HH:MM:SS format
      }
      return null;
      
    case 'CalculatedField':
    case 'Section':
    case 'RepeatableSection':
    case 'LabelField':
      return null; // These don't support default values
      
    default:
      return null;
  }
}
