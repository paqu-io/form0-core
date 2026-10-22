export { REPEATABLESUM_METADATA } from '../builtin-definitions.js';

/**
 * @builtin REPEATABLESUM
 * Metadata: builtin-definitions.js.
 * @param {*} source
 * @param {string} target
 * @returns {number}
 */
export function REPEATABLESUM() {
  throw new Error('REPEATABLESUM requires record-tree context from createRecordEvaluator().');
}
