export { AND_METADATA } from '../builtin-definitions.js';

/**
 * @builtin AND
 * Name, signature, description, examples, and contexts: see builtin-definitions.js.
 * @param {...*} args - Any number of arguments to evaluate
 * @returns {boolean} True if all arguments are truthy, false otherwise
 */
export const AND = (...args) => args.every(Boolean);
