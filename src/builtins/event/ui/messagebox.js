import { __collectEventOperation } from '../event-operations-collector.js';
import { normalizeMessageBoxOptions } from '../../../utilities/ui-requests.js';
export { MESSAGEBOX_METADATA } from '../../builtin-definitions.js';

const callbacks = new WeakMap();
export const getMessageBoxContinuation = (operation) => callbacks.get(operation);

/**
 * @builtin MESSAGEBOX
 * See builtin-definitions.js for the catalog.
 * @param {Object} options
 * @param {Function} callback
 * @returns {Object}
 */
export function MESSAGEBOX(options, callback) {
  if (typeof callback !== 'function') throw new TypeError('MESSAGEBOX requires a callback.');
  const normalized = normalizeMessageBoxOptions(options);
  const { context, ...presentation } = normalized;
  const operation = { type: 'UI_OPERATION', operation: 'MESSAGEBOX', params: presentation };
  callbacks.set(operation, { callback, options: normalized });
  __collectEventOperation(operation);
  return operation;
}
