import { formatIsoDate, isBlankDateArgument, parseIsoDate } from '../../utilities/date-utils.js';

export { DATEADD_METADATA } from '../builtin-definitions.js';

/**
 * @builtin DATEADD
 * Name, signature, description, examples, and contexts: see builtin-definitions.js.
 * @param {string | null} date - A YYYY-MM-DD date
 * @param {number | null} days - Whole number of days to add; negative values subtract
 * @returns {string | null} The resulting YYYY-MM-DD date, or null when an argument is blank
 */
export const DATEADD = (date, days) => {
  if (isBlankDateArgument(date) || isBlankDateArgument(days)) return null;

  const dayNumber = parseIsoDate(date);
  if (dayNumber === null) {
    throw new Error('DATEADD requires a date in YYYY-MM-DD format');
  }
  if (!Number.isInteger(days)) {
    throw new Error('DATEADD requires a whole number of days');
  }

  return formatIsoDate(dayNumber + days);
};
