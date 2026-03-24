import { __consumeResult } from '../builtins/registry.js';
import { __setEvalContext, __clearEvalContext } from '../builtins/control/eval.js';
import { __setDataNamesContext, __clearDataNamesContext } from '../builtins/schema/datanames.js';
import { validateExpression, createSecureContext, withTimeout } from '../security/validation.js';
import { DEFAULT_SECURITY_CONFIG } from '../security/config.js';
import {
  isMultilineCalculationExpression,
  normalizeInlineCalculationExpression,
} from '../utilities/calculation-expression-utils.js';

export function runExpression(
  expr,
  context = {},
  securityConfig = DEFAULT_SECURITY_CONFIG,
  includeEventBuiltins = false,
  schema = null,
  options = {}
) {
  try {
    // Validate expression based on security mode
    const validation = validateExpression(expr, securityConfig, includeEventBuiltins);
    if (!validation.valid) {
      if (!options.suppressConsoleWarning) {
        console.warn('[form0] Expression validation failed:', validation.reason);
      }
      return null;
    }

    // Create secure context based on security mode
    const secureContext = createSecureContext(context, securityConfig);
    const keys = Object.keys(secureContext);
    const values = Object.values(secureContext);

    // Execute expression
    const executeExpression = () => {
      // Set context for EVAL() before execution
      __setEvalContext(secureContext);
      if (schema) {
        __setDataNamesContext(schema);
      }

      try {
        // Handle both expressions and multi-line code (Windows-safe)
        const isMultiLine = isMultilineCalculationExpression(expr);

        if (isMultiLine) {
          // Execute as code block (recompile each time for now)
          const fn = new Function(...keys, expr);
          const result = fn(...values);
          // Check for consumed result from SETRESULT() calls in multiline code
          const consumed = __consumeResult();
          return consumed.called ? consumed.value : result;
        } else {
          // Execute as expression (existing behavior)
          const inlineExpression = normalizeInlineCalculationExpression(expr);
          const fn = new Function(...keys, `return (${inlineExpression});`);
          const result = fn(...values);
          const consumed = __consumeResult();
          return consumed.called ? consumed.value : result;
        }
      } finally {
        // Always clear EVAL context after execution
        __clearEvalContext();
        if (schema) {
          __clearDataNamesContext();
        }
      }
    };

    // Apply timeout if configured (for safe/custom modes)
    if (securityConfig.maxExecutionTime && securityConfig.maxExecutionTime > 0) {
      // For now, we'll just execute directly since withTimeout is async
      // In a future version, we could make this async
      return executeExpression();
    }

    return executeExpression();
  } catch (e) {
    if (typeof options.onError === 'function') {
      options.onError(e);
    }
    if (!options.suppressConsoleWarning) {
      console.warn('[form0] Expression evaluation failed:', e.message);
    }
    return null;
  }
}
