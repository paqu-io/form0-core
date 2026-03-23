import { BUILTIN_CONTEXTS, defineBuiltinMetadata } from '../builtin-metadata.js';

/**
 * @builtin ARRAY
 * @description Returns an array from its arguments. Can parse string representations of arrays (with single or double quotes) and comma-separated values.
 * @param {...*} args - Values to create an array from. Accepts multiple arguments or a single string to parse
 * @returns {Array} An array containing the arguments
 * @example
 * // Create array from multiple arguments
 * ARRAY(1, 2, 3) // returns [1, 2, 3]
 * @example
 * // Pass an existing array (no flattening)
 * ARRAY([1, 2, 3]) // returns [1, 2, 3]
 * @example
 * // Parse JSON array string (double quotes)
 * ARRAY("[1, 2, 3]") // returns [1, 2, 3]
 * @example
 * // Parse array string with single quotes
 * ARRAY("['a', 'b', 'c']") // returns ['a', 'b', 'c']
 * @example
 * // Parse simple comma-separated string (becomes array of strings)
 * ARRAY("one, two, three") // returns ["one", "two", "three"]
 * @example
 * // Nested arrays are preserved (no flattening)
 * ARRAY([1, [2, 3]]) // returns [1, [2, 3]]
 * @example
 * // Empty arguments
 * ARRAY() // returns []
 * @example
 * // For complex parsing, JSON.parse() can be used:
 * // EVAL('JSON.parse("[1,2,3]")')
 */
export const ARRAY_METADATA = defineBuiltinMetadata({
  name: 'ARRAY',
  category: 'logical',
  signature: 'ARRAY(...values)',
  description: 'Build an array from individual arguments.',
  examples: ['ARRAY($city, $country)'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const ARRAY = (...args) => {
  // Handle empty arguments
  if (args.length === 0) {
    return [];
  }

  // If single argument and it's a string, try to parse it
  if (args.length === 1 && typeof args[0] === 'string') {
    return parseArrayString(args[0]);
  }

  // If single argument and it's already an array, return it as-is (no flattening)
  if (args.length === 1 && Array.isArray(args[0])) {
    return args[0];
  }

  // Otherwise, return all arguments as an array (no flattening)
  return args;
};

/**
 * Parse a string into an array
 * Handles:
 * - JSON arrays with double quotes: "[1, 2, 3]" or '["a", "b"]'
 * - Arrays with single quotes: "['a', 'b', 'c']"
 * - Simple comma-separated strings: "a, b, c"
 * @param {string} str - The string to parse
 * @returns {Array} Parsed array
 */
function parseArrayString(str) {
  const trimmed = str.trim();

  // Check if it looks like an array (starts with [ and ends with ])
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    // First try JSON.parse for double-quoted arrays
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      // If JSON.parse fails, it might be single-quoted
      // Convert single quotes to double quotes for JSON parsing
      // This is a simple approach with known limitations:
      // - Doesn't handle apostrophes inside strings (e.g., 'it's')
      // - Doesn't handle escaped quotes
      try {
        const doubleQuoted = trimmed.replace(/'/g, '"');
        return JSON.parse(doubleQuoted);
      } catch (e2) {
        console.warn('[form0] ARRAY() failed to parse array string:', trimmed);
        // Return the string as a single-element array as fallback
        return [str];
      }
    }
  }

  // If it doesn't look like an array, treat as comma-separated string
  // Split by comma and trim each value
  // Note: This keeps everything as strings (no type conversion)
  return trimmed
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== ''); // Remove empty strings
}
