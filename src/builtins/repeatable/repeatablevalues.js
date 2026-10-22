export { REPEATABLEVALUES_METADATA } from '../builtin-definitions.js';

/**
 * @builtin REPEATABLEVALUES
 * Metadata: builtin-definitions.js.
 * @param {*} source
 * @param {string} target
 * @returns {Array}
 */
export function REPEATABLEVALUES() {
  throw new Error('REPEATABLEVALUES requires record-tree context from createRecordEvaluator().');
}
