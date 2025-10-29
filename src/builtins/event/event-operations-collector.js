// Global state for event operations collection
let _eventOperations = [];

/**
 * Internal function to collect event operations
 * @param {Object} operation - The operation descriptor to collect
 */
export function __collectEventOperation(operation) {
  _eventOperations.push(operation);
}

/**
 * Internal function to consume all collected event operations
 * @returns {Array} Array of collected operations
 */
export function __consumeEventOperations() {
  const operations = [..._eventOperations]; // Copy array
  _eventOperations = []; // Clear for next execution
  return operations;
}
