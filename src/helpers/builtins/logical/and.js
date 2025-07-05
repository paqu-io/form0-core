/**
 * @builtin AND
 * @description Logical AND operation that returns true only if all arguments are truthy
 * @param {...*} args - Any number of arguments to evaluate
 * @returns {boolean} True if all arguments are truthy, false otherwise
 * @example
 * // Check if user is adult and has premium account
 * AND(user.age >= 18, user.isPremium)
 * @example
 * // Multiple conditions
 * AND(name.length > 0, email.includes("@"), age >= 13)
 */
export const AND = (...args) => args.every(Boolean); 