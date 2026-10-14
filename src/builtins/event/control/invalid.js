import { __collectEventOperation } from '../event-operations-collector.js';
export { INVALID_METADATA } from '../../builtin-definitions.js';

/**
 * @builtin INVALID
 * See builtin-definitions.js for the authoritative catalog entry.
 * @param {string} message
 * @returns {Object} Validation descriptor consumed by managed validation execution.
 */
export function INVALID(message) {
  if (typeof message !== 'string' || !message.trim()) {
    throw new Error('INVALID() requires a nonempty string.');
  }
  const operation = { type: 'VALIDATION_OPERATION', operation: 'INVALID', params: { message } };
  if (!__collectEventOperation(operation)) throw new Error('INVALID() requires an event scope.');
  return operation;
}
