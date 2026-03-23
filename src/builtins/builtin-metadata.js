/**
 * @typedef {'calculation' | 'event'} BuiltinContext
 *
 * @typedef {Object} BuiltinMetadata
 * @property {string} name
 * @property {string} category
 * @property {string} signature
 * @property {string} description
 * @property {string[]} examples
 * @property {BuiltinContext[]} contexts
 */

export const BUILTIN_CONTEXTS = Object.freeze({
  CALCULATION: 'calculation',
  EVENT: 'event',
});

/**
 * Create immutable metadata for a builtin implementation.
 *
 * @param {BuiltinMetadata} definition
 * @returns {BuiltinMetadata}
 */
export function defineBuiltinMetadata(definition) {
  return Object.freeze({
    ...definition,
    examples: Object.freeze([...(definition.examples ?? [])]),
    contexts: Object.freeze([...(definition.contexts ?? [])]),
  });
}

/**
 * Return a mutable clone of builtin metadata for external consumers.
 *
 * @param {BuiltinMetadata} definition
 * @returns {BuiltinMetadata}
 */
export function cloneBuiltinMetadata(definition) {
  return {
    ...definition,
    examples: [...definition.examples],
    contexts: [...definition.contexts],
  };
}
