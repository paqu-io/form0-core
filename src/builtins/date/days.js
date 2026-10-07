import { isBlankDateArgument, parseIsoDate } from '../../utilities/date-utils.js';

export { DAYS_METADATA } from '../builtin-definitions.js';

/**
 * @builtin DAYS
 * Name, signature, description, examples, and contexts: see builtin-definitions.js.
 * @param {string | null} endDate - A YYYY-MM-DD date
 * @param {string | null} startDate - A YYYY-MM-DD date
 * @returns {number | null} Days from startDate to endDate, or null when an argument is blank
 */
export const DAYS = (endDate, startDate) => {
  if (isBlankDateArgument(endDate) || isBlankDateArgument(startDate)) return null;

  const end = parseIsoDate(endDate);
  const start = parseIsoDate(startDate);
  if (end === null || start === null) {
    throw new Error('DAYS requires dates in YYYY-MM-DD format');
  }

  return end - start;
};
