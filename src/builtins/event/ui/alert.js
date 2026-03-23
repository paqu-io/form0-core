import { __collectEventOperation } from '../event-operations-collector.js';
import { BUILTIN_CONTEXTS, defineBuiltinMetadata } from '../../builtin-metadata.js';

/**
 * ALERT builtin for form events
 * Automatically collects operation for platform execution
 * @param {string} title - The title to display in the alert
 * @param {string} message - The message to display in the alert (optional)
 * @returns {Object} Operation descriptor for platform execution (for backward compatibility)
 */
export const ALERT_METADATA = defineBuiltinMetadata({
  name: 'ALERT',
  category: 'event',
  signature: "ALERT(title, message = '')",
  description: 'Display an alert from a form event handler.',
  examples: ["ALERT('Saved', 'The record was saved successfully.')"],
  contexts: [BUILTIN_CONTEXTS.EVENT],
});

export function ALERT(title, message = '') {
  // Create operation descriptor
  const operation = {
    type: 'UI_OPERATION',
    operation: 'ALERT',
    params: {
      title: String(title),
      message: String(message),
    },
  };

  // Collect operation for automatic execution
  __collectEventOperation(operation);

  // Return operation descriptor for backward compatibility
  return operation;
}
