import { __collectEventOperation } from '../event-operations-collector.js';
export { ON_METADATA } from '../../builtin-definitions.js';
import { isValidEventType } from '../../../engine/event-registry.js';

/**
 * @builtin ON
 * Name, signature, description, examples, and contexts: see builtin-definitions.js.
 * Registers an event handler within event context
 * Automatically collects operation for platform execution
 *
 * @param {string} eventType - The event type to listen for
 * @param {string|Function} fieldKeyOrCallback - Field key for field events, or callback for global events
 * @param {Function} [callback] - Callback function for field events
 * @returns {Object} Operation descriptor for platform execution (for backward compatibility)
 */
export function ON(eventType, fieldKeyOrCallback, callback) {
  if (typeof eventType !== 'string' || eventType.trim().length === 0) {
    console.warn('[form0] ON() requires a non-empty event type string');
    return null;
  }

  if (!isValidEventType(eventType)) {
    console.warn(`[form0] ON() received an unknown event type: ${eventType}`);
    return null;
  }

  let fieldKey = '*';
  let actualCallback = fieldKeyOrCallback;

  // Handle both signatures: ON('load-record', func) and ON('change', 'field', func)
  if (typeof fieldKeyOrCallback === 'string') {
    fieldKey = fieldKeyOrCallback;
    actualCallback = callback;
  }

  if (typeof actualCallback !== 'function') {
    console.warn('[form0] ON() requires a callback function');
    return null;
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
