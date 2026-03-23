import { __collectEventOperation } from '../event-operations-collector.js';
import { BUILTIN_CONTEXTS, defineBuiltinMetadata } from '../../builtin-metadata.js';

/**
 * SETVALUE builtin for form events
 * Sets a field value within event context
 * Automatically collects operation for platform execution
 * Supports multiple field types:
 * - TextField: string values
 * - NumericField: numeric values
 * - SingleChoiceField: string choice values
 * - MultiChoiceField: array of string choice values
 *
 * @param {string} fieldDataName - The data name of the field to set
 * @param {any} valueToSet - The value to set (string, number, array, etc.)
 * @returns {Object} Operation descriptor for platform execution (for backward compatibility)
 *
 * @example
 * // Set TextField value
 * SETVALUE('field_dataname', 'value_to_set')
 *
 * @example
 * // Set NumericField value
 * SETVALUE('field_dataname', 12)
 *
 * @example
 * // Set SingleChoiceField value
 * SETVALUE('field_dataname', 'choicefield_value_to_set')
 *
 * @example
 * // Set MultiChoiceField value
 * SETVALUE('field_dataname', ['value1', 'value2', 'value3'])
 */
export const SETVALUE_METADATA = defineBuiltinMetadata({
  name: 'SETVALUE',
  category: 'event',
  signature: 'SETVALUE(fieldDataName, valueToSet)',
  description: 'Set a field value from a form event handler.',
  examples: ["SETVALUE('field_dataname', 'value_to_set')"],
  contexts: [BUILTIN_CONTEXTS.EVENT],
});

export function SETVALUE(fieldDataName, valueToSet) {
  // Create operation descriptor
  const operation = {
    type: 'FIELD_OPERATION',
    operation: 'SETVALUE',
    params: {
      fieldDataName: String(fieldDataName),
      valueToSet: valueToSet,
    },
  };

  // Collect operation for automatic execution
  __collectEventOperation(operation);

  // Return operation descriptor for backward compatibility
  return operation;
}
