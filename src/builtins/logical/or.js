export { OR_METADATA } from '../builtin-definitions.js';

/**
 * @builtin OR
 * Name, signature, description, examples, and contexts: see builtin-definitions.js.
 * @param {...*} args - Any number of arguments to evaluate
 * @returns {boolean} True if at least one argument is truthy, false otherwise
 */
export const OR = (...args) => args.some(Boolean);
