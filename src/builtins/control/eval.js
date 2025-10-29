import { validateExpression } from '../../security/validation.js';
import { SAFE_SECURITY_CONFIG } from '../../security/config.js';

/**
 * @builtin EVAL
 * @description Evaluates a dynamic expression in a controlled, secure context
 * @param {string} expression - The dynamic expression to evaluate
 * @returns {*} The result of the evaluated expression
 * @example
 * // Dynamic field access
 * EVAL('$' + dynamicFieldName)
 * @example
 * // Dynamic builtin calls
 * EVAL('CHOICEVALUE($' + fieldVar + ')')
 * @example
 * // Computed field references
 * EVAL('$city' + '_suffix')
 */
// Global context for EVAL() - set during expression evaluation
let _evalContext = null;

/**
 * Set the context for EVAL() during expression evaluation
 * Called internally by the expression evaluator
 */
export function __setEvalContext(context) {
  _evalContext = context;
}

/**
 * Clear the EVAL() context after expression evaluation
 * Called internally by the expression evaluator
 */
export function __clearEvalContext() {
  _evalContext = null;
}

export const EVAL = (expression) => {
  // Step 1: Basic validation
  if (typeof expression !== 'string') {
    console.warn('[form0] EVAL() requires a string expression');
    return null;
  }

  if (!expression || expression.trim() === '') {
    console.warn('[form0] EVAL() requires a non-empty expression');
    return null;
  }

  // Step 2: Security validation for EVAL() expressions
  const securityValidation = validateEvalExpression(expression);
  if (!securityValidation.valid) {
    console.warn('[form0] EVAL() security validation failed:', securityValidation.reason);
    return null;
  }

  // Step 3: Hybrid evaluation - smart string building with field resolution
  return evaluateHybridExpression(expression, _evalContext);
};

/**
 * Enhanced security validation specifically for EVAL() expressions
 * More restrictive than general expression validation
 */
function validateEvalExpression(expression) {
  // Step 2a: Use existing security validation as base (SAFE mode)
  const baseValidation = validateExpression(expression, SAFE_SECURITY_CONFIG, true);
  if (!baseValidation.valid) {
    return baseValidation;
  }

  // Step 2b: EVAL-specific restrictions
  const evalBlockedPatterns = [
    /\bsetTimeout\b/i,
    /\bsetInterval\b/i,
    /\bPromise\b/i,
    /\basync\b/i,
    /\bawait\b/i,
    /\bthis\b/i,
    /\bnew\s+/i,
    /\bdelete\b/i,
    /\btypeof\b/i,
    /\binstanceof\b/i,
    /\bfor\s*\(/i,
    /\bwhile\s*\(/i,
    /\bdo\s*\{/i,
    /\btry\s*\{/i,
    /\bcatch\s*\(/i,
    /\bthrow\b/i,
    /\byield\b/i,
    /\bclass\b/i,
    /\bextends\b/i,
    /\bsuper\b/i,
    /\bwith\s*\(/i,
    // Block object/array destructuring patterns
    /\{\s*\.\.\./,
    /\[\s*\.\.\./,
    // Block assignment operators beyond basic =
    /[+\-*/%^&|]=/,
    // Block increment/decrement
    /\+\+/,
    /--/,
  ];

  // Check EVAL-specific blocked patterns
  for (const pattern of evalBlockedPatterns) {
    if (pattern.test(expression)) {
      return {
        valid: false,
        reason: `EVAL() blocked potentially unsafe pattern: ${pattern.source}`,
      };
    }
  }

  // Step 2c: Only allow specific safe patterns
  const allowedPatterns = [
    /^[\w\s+\-*/%()'".,\$]+$/, // Basic literals, operators, field refs
    /\b[A-Z_][A-Z0-9_]*\s*\(/, // Form0 builtin calls
    /\$[a-zA-Z_][a-zA-Z0-9_]*/, // Field references
  ];

  const hasAllowedPattern = allowedPatterns.some((pattern) => pattern.test(expression));
  if (!hasAllowedPattern) {
    return {
      valid: false,
      reason: 'EVAL() expression contains unsupported syntax',
    };
  }

  return { valid: true };
}

/**
 * Hybrid evaluation: String building with smart field resolution
 * @param {string} expression - The expression to evaluate
 * @param {Object} formContext - The current form context with field values
 * @returns {*} The evaluation result
 */
function evaluateHybridExpression(expression, formContext) {
  try {
    // Step 3a: Handle simple string literals and field references directly
    if (isSimpleStringLiteral(expression)) {
      // Simple string literal - return as is
      const result = expression;
      console.log('[form0] EVAL() simple string:', expression, '→', result);
      return result;
    }

    if (isFieldReference(expression)) {
      // Field reference - resolve from context
      const fieldValue = formContext?.[expression];
      if (fieldValue !== undefined) {
        console.log('[form0] EVAL() resolved field reference:', expression, '→', fieldValue);
        return fieldValue;
      } else {
        console.warn('[form0] EVAL() field reference not found:', expression);
        return null;
      }
    }

    // Step 3b: Handle complex expressions that need evaluation
    const basicContext = {
      // Safe string/math operations
      String: String,
      Number: Number,
      Math: Math,
    };

    // Step 3c: Add form context for variable access
    Object.assign(basicContext, formContext || {});

    // Step 3d: Evaluate expression for string building
    const keys = Object.keys(basicContext);
    const values = Object.values(basicContext);

    const fn = new Function(...keys, `return (${expression});`);
    const result = fn(...values);

    // Step 3e: Check if result should be resolved as field reference
    if (typeof result === 'string' && result.startsWith('$')) {
      // This is a field reference - resolve it from context
      const fieldValue = formContext?.[result];
      if (fieldValue !== undefined) {
        console.log(
          '[form0] EVAL() resolved field reference:',
          expression,
          '→',
          result,
          '→',
          fieldValue
        );
        return fieldValue;
      } else {
        console.warn('[form0] EVAL() field reference not found:', result);
        return null;
      }
    }

    // Step 3f: Return string result for dataname references
    console.log('[form0] EVAL() built string:', expression, '→', result);
    return result;
  } catch (error) {
    console.warn('[form0] EVAL() execution failed:', error.message);
    return null;
  }
}

/**
 * Check if expression is a simple string literal (no variables or operations)
 */
function isSimpleStringLiteral(expr) {
  // Check if it's a simple word/identifier without special characters
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(expr);
}

/**
 * Check if expression is a field reference (starts with $)
 */
function isFieldReference(expr) {
  return typeof expr === 'string' && expr.startsWith('$');
}

// Remove the old createRestrictedEvalContext function as it's no longer needed
