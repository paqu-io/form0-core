import { evaluateCalculatedFields } from './engine/calculation.js';
import { evaluateVisibility } from './engine/conditions.js';
import { evaluateRequirement } from './engine/conditions.js';
import { evaluateReadOnly } from './engine/conditions.js';
import { validateFields } from './engine/validation.js';
import { builtins } from './helpers/builtins.js';
import { validateSchema } from './utils/validate-schema.js';
import { flattenFields } from './utils/flatten-fields.js';
import { DEFAULT_SECURITY_CONFIG } from './utils/security.js';

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
  for (const field of allFields) {
    if (!(field.data_name in values)) {
      values[field.data_name] = null;
    }
  }
  const errors = {};
  const visible = {};
  const required = {};
  const read_only = {};

  const allHelpers = { ...builtins, ...helpers };

  function evalForm() {
    evaluateCalculatedFields(form, values, allHelpers, security);
    evaluateRequirement(form, values, required);
    evaluateVisibility(form, values, visible);
    evaluateReadOnly(form, values, read_only);
    validateFields(form, values, errors);
  }

  function trigger(eventType, fieldKey) {
    // placeholder for ON(change), ON(load-record), etc.
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
