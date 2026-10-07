export { ARRAY_METADATA } from '../builtin-definitions.js';

/**
 * @builtin ARRAY
 * Name, signature, description, examples, and contexts: see builtin-definitions.js.
 * @param {...*} args - Values to create an array from. Accepts multiple arguments or a single string to parse
 * @returns {Array} An array containing the arguments
 */
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
