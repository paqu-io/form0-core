export { SETRESULT_METADATA } from '../builtin-definitions.js';

// Global state for result management
let _resultSet = false;
let _resultValue;
let _resultScopeDepth = 0;

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

/**
 * Start an isolated synchronous result scope and return its restoration function.
 * Nested scopes restore the enclosing SETRESULT state; top-level scopes retain the
 * legacy behavior of clearing stale state at both evaluation boundaries.
 * @returns {() => void}
 */
export function __beginResultScope() {
  const previous = { called: _resultSet, value: _resultValue };
  const restorePrevious = _resultScopeDepth > 0;
  _resultScopeDepth += 1;
  __resetResult();

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    _resultScopeDepth = Math.max(0, _resultScopeDepth - 1);
    if (restorePrevious) {
      _resultSet = previous.called;
      _resultValue = previous.value;
    } else {
      __resetResult();
    }
  };
}

/** Clear calculation result state without consuming it. */
export function __resetResult() {
  _resultSet = false;
  _resultValue = undefined;
}
