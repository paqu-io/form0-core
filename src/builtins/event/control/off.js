import { __collectEventOperation } from '../event-operations-collector.js';
export { OFF_METADATA } from '../../builtin-definitions.js';
import { isValidEventType } from '../../../engine/event-registry.js';

/**
 * @builtin OFF
 * Name, signature, description, examples, and contexts: see builtin-definitions.js.
 * Removes event handlers within event context
 * Automatically collects operation for platform execution
 *
 * @param {string} eventType - The event type to remove handlers from
 * @param {string|Function} [fieldKeyOrCallback] - Field key for field events, or callback for global events
 * @param {Function} [callback] - Callback function for field events (when fieldKeyOrCallback is a field key)
 * @returns {Object} Operation descriptor for platform execution (for backward compatibility)
 */
export function OFF(eventType, fieldKeyOrCallback, callback) {
  if (typeof eventType !== 'string' || eventType.trim().length === 0) {
    console.warn('[form0] OFF() requires a non-empty event type string');
    return null;
  }

  if (!isValidEventType(eventType)) {
    console.warn(`[form0] OFF() received an unknown event type: ${eventType}`);
    return null;
  }

  let fieldKey = '*';
  let actualCallback = undefined;

  // Handle different signatures
  if (typeof fieldKeyOrCallback === 'string') {
    // OFF('change', 'city', callback) or OFF('change', 'city')
    fieldKey = fieldKeyOrCallback;
    actualCallback = callback;
  } else if (typeof fieldKeyOrCallback === 'function') {
    // OFF('load-record', callback)
    actualCallback = fieldKeyOrCallback;
  }
  // If fieldKeyOrCallback is undefined, it's OFF('load-record') - remove all handlers

  // Create operation descriptor
  const operation = {
    type: 'EVENT_OPERATION',
    operation: 'OFF',
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
