import { BUILTIN_CONTEXTS, defineBuiltinMetadata } from '../builtin-metadata.js';

/**
 * @builtin UPPER
 * @description Returns the uppercase version of a string
 * @param {string} value - The string to convert to uppercase
 * @returns {string} The uppercase version of the input string
 * @example
 * // Returns "HELLO WORLD"
 * UPPER("hello world")
 * @example
 * // Returns "FORM0"
 * UPPER("form0")
 * @example
 * // Returns "ABC123"
 * UPPER("abc123")
 */
export const UPPER_METADATA = defineBuiltinMetadata({
  name: 'UPPER',
  category: 'string',
  signature: 'UPPER(value)',
  description: 'Convert a string to uppercase.',
  examples: ['UPPER($city_name)'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const UPPER = (value) => {
  if (value == null) {
    return '';
  }
  return String(value).toUpperCase();
};
