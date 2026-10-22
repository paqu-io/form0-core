export { REPEATABLEVALUES_METADATA, REPEATABLESUM_METADATA } from '../builtin-definitions.js';

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
