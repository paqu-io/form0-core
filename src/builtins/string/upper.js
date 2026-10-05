export { UPPER_METADATA } from '../builtin-definitions.js';

/**
 * @builtin UPPER
 * Name, signature, description, examples, and contexts: see builtin-definitions.js.
 * @param {string} value - The string to convert to uppercase
 * @returns {string} The uppercase version of the input string
 */
export const UPPER = (value) => {
  if (value == null) {
    return '';
  }
  return String(value).toUpperCase();
};
