export { ROUND_METADATA } from '../builtin-definitions.js';

/**
 * @builtin ROUND
 * Name, signature, description, examples, and contexts: see builtin-definitions.js.
 * @param {number} value - The numeric value to be rounded
 * @param {number} places - The number of decimal places to round to
 * @returns {number} The value rounded to the specified number of decimal places
 */
export const ROUND = (value, places) => {
  if (typeof value !== 'number' || typeof places !== 'number') {
    throw new Error('ROUND requires two numeric arguments');
  }

  const multiplier = Math.pow(10, places);
  return Math.round(value * multiplier) / multiplier;
};
