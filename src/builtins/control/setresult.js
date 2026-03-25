import { BUILTIN_CONTEXTS, defineBuiltinMetadata } from '../builtin-metadata.js';

// Global state for result management
let _resultSet = false;
let _resultValue;

/**
 * @builtin SETRESULT
 * @description Sets a result value that can be consumed by the form engine
 * @param {*} value - The value to set as the result
 * @returns {*} The same value that was passed in
 * @example
 * // Set a calculation result
 * SETRESULT(price * quantity * (1 + taxRate))
 * @example
 * // Set a conditional result
 * SETRESULT(IF(isEligible, discount, 0))
 */
export const SETRESULT_METADATA = defineBuiltinMetadata({
  name: 'SETRESULT',
  category: 'control',
  signature: 'SETRESULT(value)',
  description: 'Set the final return value for multiline calculations.',
  examples: ['SETRESULT($price * $quantity)'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION],
});

export const SETRESULT = (value) => {
  _resultSet = true;
  _resultValue = value;
  return value;
};

/**
 * Internal function to consume the result value
 * @returns {Object} Object with called boolean and value
 */
export function __consumeResult() {
  const value = _resultValue;
  const called = _resultSet;
  _resultSet = false;
  _resultValue = undefined;
  return { called, value };
}
