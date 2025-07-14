import { evaluateCalculatedFields } from './engine/calculation.js';
import { evaluateVisibility } from './engine/conditions.js';
import { evaluateRequirement } from './engine/conditions.js';
import { evaluateReadOnly } from './engine/conditions.js';
import { validateFields } from './engine/validation.js';
import { builtins, eventBuiltins } from './helpers/builtins.js';
import { validateSchema } from './utils/validate-schema.js';
import { flattenFields } from './utils/flatten-fields.js';
import { DEFAULT_SECURITY_CONFIG } from './utils/security.js';
import { EventManager } from './engine/events.js';

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
    if (field.type === 'SingleChoiceField' || field.type === 'MultiChoiceField') {
      const valueToLabelMap = new Map();
      field.choices.forEach(choice => {
        valueToLabelMap.set(choice.value, choice.label);
      });
      choiceFieldMap.set(field.data_name, valueToLabelMap);
    }
  }
  
  for (const field of allFields) {
    if (!(field.data_name in values)) {
      // Initialize SingleChoiceField with proper structure
      if (field.type === 'SingleChoiceField') {
        values[field.data_name] = {
          choice: [],
          other: []
        };
      } else if (field.type === 'MultiChoiceField') {
        values[field.data_name] = {
          choices: [],
          other: []
        };
      } else {
        values[field.data_name] = null;
      }
    } else if (field.type === 'SingleChoiceField') {
      // Enrich SingleChoiceField values with labels from schema
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
