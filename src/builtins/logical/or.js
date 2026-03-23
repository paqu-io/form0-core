import { BUILTIN_CONTEXTS, defineBuiltinMetadata } from '../builtin-metadata.js';

/**
 * @builtin OR
 * @description Logical OR operation that returns true if at least one argument is truthy
 * @param {...*} args - Any number of arguments to evaluate
 * @returns {boolean} True if at least one argument is truthy, false otherwise
 * @example
 * // Check if user has any premium feature
 * OR(user.isPremium, user.isVip, user.hasSubscription)
 * @example
 * // Validation - either email or phone is required
 * OR(email.length > 0, phone.length > 0)
 */
export const OR_METADATA = defineBuiltinMetadata({
  name: 'OR',
  category: 'logical',
  signature: 'OR(...conditions)',
  description: 'Return true when at least one argument is truthy.',
  examples: ['OR($email, $phone)'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const OR = (...args) => args.some(Boolean);
