/**
 * @builtin IF
 * @description Conditional logic function that returns one of two values based on a condition
 * @param {boolean} condition - The condition to evaluate
 * @param {*} trueValue - Value returned if condition is true
 * @param {*} falseValue - Value returned if condition is false
 * @returns {*} Either trueValue or falseValue
 * @example
 * // Returns "Yes" if age >= 18, otherwise "No"
 * IF(age >= 18, "Yes", "No")
 * @example
 * // Nested conditions for shipping cost
 * IF(country === "US", IF(state === "CA", 8.99, 5.99), 15.99)
 */
export const IF = (cond, a, b) => (cond ? a : b);
