import { __collectEventOperation } from '../event-operations-collector.js';

/**
 * ALERT builtin for form events
 * Automatically collects operation for platform execution
 * @param {string} message - The message to display in the alert
 * @returns {Object} Operation descriptor for platform execution (for backward compatibility)
 */
export function ALERT(message) {
  // Create operation descriptor
  const operation = {
    type: 'UI_OPERATION',
    operation: 'ALERT',
    params: { message: String(message) }
  };
  
  // Collect operation for automatic execution
  __collectEventOperation(operation);
  
  // Return operation descriptor for backward compatibility
  return operation;
} 