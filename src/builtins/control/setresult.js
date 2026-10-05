export { SETRESULT_METADATA } from '../builtin-definitions.js';

// Global state for result management
let _resultSet = false;
let _resultValue;

/**
 * @builtin SETRESULT
 * Name, signature, description, examples, and contexts: see builtin-definitions.js.
 * @param {*} value - The value to set as the result
 * @returns {*} The same value that was passed in
 */
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

/** Clear calculation result state without consuming it. */
export function __resetResult() {
  _resultSet = false;
  _resultValue = undefined;
}
