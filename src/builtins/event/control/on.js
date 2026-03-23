import { __collectEventOperation } from '../event-operations-collector.js';
import { BUILTIN_CONTEXTS, defineBuiltinMetadata } from '../../builtin-metadata.js';

/**
 * ON builtin for form events
 * Registers an event handler within event context
 * Automatically collects operation for platform execution
 *
 * @param {string} eventType - The event type to listen for
 * @param {string|Function} fieldKeyOrCallback - Field key for field events, or callback for global events
 * @param {Function} [callback] - Callback function for field events
 * @returns {Object} Operation descriptor for platform execution (for backward compatibility)
 *
 * @example
 * // Register global event handler
 * ON('load-record', function() { ALERT('Record loaded!'); });
 *
 * @example
 * // Register field-specific event handler
 * ON('change', 'city', function(event) { ALERT('City changed!'); });
 */
export const ON_METADATA = defineBuiltinMetadata({
  name: 'ON',
  category: 'event',
  signature: 'ON(eventType, fieldKeyOrCallback, callback)',
  description: 'Register an event handler within form event code.',
  examples: ["ON('change', 'city', function(event) { ALERT('City changed!'); })"],
  contexts: [BUILTIN_CONTEXTS.EVENT],
});

export function ON(eventType, fieldKeyOrCallback, callback) {
  let fieldKey = '*';
  let actualCallback = fieldKeyOrCallback;

  // Handle both signatures: ON('load-record', func) and ON('change', 'field', func)
  if (typeof fieldKeyOrCallback === 'string') {
    fieldKey = fieldKeyOrCallback;
    actualCallback = callback;
  }

  // Create operation descriptor
  const operation = {
    type: 'EVENT_OPERATION',
    operation: 'ON',
    params: {
      eventType: String(eventType),
      fieldKey: String(fieldKey),
      callback: actualCallback,
    },
  };

  // Collect operation for automatic execution
  __collectEventOperation(operation);

  // Return operation descriptor for backward compatibility
  return operation;
}
