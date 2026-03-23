import { BUILTIN_CONTEXTS, defineBuiltinMetadata } from '../builtin-metadata.js';

/**
 * @builtin FORM
 * @description Access to the nested JSON form definition (future implementation)
 * @returns {Object} The form schema object
 * @example
 * // Get form title
 * FORM().title
 * @example
 * // Access field definitions
 * FORM().elements[0].label
 * @example
 * // Check if form has RepeatableSections
 * FORM().elements.some(el => el.type === 'RepeatableSection')
 */
export const FORM_METADATA = defineBuiltinMetadata({
  name: 'FORM',
  category: 'schema',
  signature: 'FORM()',
  description: 'Access the form definition. Reserved for a future implementation.',
  examples: ['FORM()'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export function FORM() {
  // Placeholder for future implementation
  // Will provide access to nested JSON form definition
  // This will be available in both CalculatedFields and Form Events
  throw new Error('FORM() builtin not yet implemented - planned for future release');
}
