// Calendar-date helpers for DateField values, which use the YYYY-MM-DD format.
// Dates are handled as UTC calendar days so that arithmetic never shifts across DST changes.

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const pad = (value, length = 2) => String(value).padStart(length, '0');

/**
 * Format a Date as YYYY-MM-DD using the local calendar day.
 *
 * @param {Date} [date]
 * @returns {string}
 */
export function formatLocalDate(date = new Date()) {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Parse a YYYY-MM-DD string into a day number (days since 1970-01-01).
 *
 * @param {string} value
 * @returns {number | null} null when the value is not a valid calendar date
 */
export function parseIsoDate(value) {
  if (typeof value !== 'string') return null;
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return null;

  const [year, month, day] = match.slice(1).map(Number);
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) return null;
  if (date.getUTCDate() !== day) return null;

  return time / MS_PER_DAY;
}

/**
 * Format a day number (days since 1970-01-01) as YYYY-MM-DD.
 *
 * @param {number} dayNumber
 * @returns {string}
 */
export function formatIsoDate(dayNumber) {
  const date = new Date(dayNumber * MS_PER_DAY);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isBlankDateArgument(value) {
  return value === null || value === undefined || value === '';
}
