import { __consumeResult, __resetResult } from '../builtins/registry.js';
import { __setEvalContext, __clearEvalContext } from '../builtins/control/eval.js';
import { __setDataNamesContext, __clearDataNamesContext } from '../builtins/schema/datanames.js';
import { validateExpression, createSecureContext, withTimeout } from '../security/validation.js';
import { DEFAULT_SECURITY_CONFIG } from '../security/config.js';
import {
  isMultilineCalculationExpression,
  normalizeInlineCalculationExpression,
} from '../utilities/calculation-expression-utils.js';

const MISSING_RESULT_MESSAGE =
  'Multiline calculation produced no value because it does not call SETRESULT().';

function reportMissingResult(options) {
  options.onDiagnostic?.({
    code: 'missing_result',
    severity: 'warning',
    phase: 'runtime',
    message: MISSING_RESULT_MESSAGE,
    suggestion: 'Wrap the final value in SETRESULT(), or write the calculation on a single line.',
  });
  if (!options.suppressConsoleWarning) {
    const field = options.fieldName ? ` (${options.fieldName})` : '';
    console.warn(`[form0] missing_result${field}: ${MISSING_RESULT_MESSAGE}`);
  }
}

export function runExpression(
  expr,
  context = {},
  securityConfig = DEFAULT_SECURITY_CONFIG,
  includeEventBuiltins = false,
  schema = null,
  options = {}
) {
  // SETRESULT uses synchronous evaluation-scoped state. Clear it at both boundaries so a
  // previously failed expression can never influence this evaluation.
  __resetResult();
  let phase = 'runtime';
  try {
    const sourceExpression = options.sourceExpression ?? expr;
    // Validate expression based on security mode
    const validation = validateExpression(sourceExpression, securityConfig, includeEventBuiltins);
    if (!validation.valid) {
      options.onDiagnostic?.({
        code: 'expression_validation_failed',
        phase: 'validation',
        message: validation.reason,
      });
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
      const restoreReporting = __setEvalContext(secureContext, options.evalReporting);
      if (schema) {
        __setDataNamesContext(schema);
      }

      try {
        // Handle both expressions and multi-line code (Windows-safe)
        const isMultiLine =
          options.evaluateAsExpression !== true &&
          isMultilineCalculationExpression(sourceExpression);

        if (isMultiLine) {
          // Execute as code block (recompile each time for now)
          phase = 'syntax';
          const fn = new Function(...keys, expr);
          phase = 'runtime';
          const result = fn(...values);
          // Check for consumed result from SETRESULT() calls in multiline code
          const consumed = __consumeResult();
          if (options.requireResult && !consumed.called && result === undefined) {
            reportMissingResult(options);
          }
          return consumed.called ? consumed.value : result;
        } else {
          // Execute as expression (existing behavior)
          const inlineExpression = normalizeInlineCalculationExpression(expr);
          phase = 'syntax';
          const fn = new Function(...keys, `return (${inlineExpression});`);
          phase = 'runtime';
          const result = fn(...values);
          const consumed = __consumeResult();
          return consumed.called ? consumed.value : result;
        }
      } finally {
        __resetResult();
        // Always clear EVAL context after execution
        __clearEvalContext();
        restoreReporting();
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
    options.onDiagnostic?.({
      code:
        phase === 'syntax'
          ? e instanceof SyntaxError
            ? 'invalid_syntax'
            : 'compilation_error'
          : 'runtime_exception',
      phase,
      message: e instanceof Error && e.message ? e.message : 'Unknown calculation runtime error.',
    });
    if (typeof options.onError === 'function') {
      options.onError(e);
    }
    if (!options.suppressConsoleWarning) {
      console.warn('[form0] Expression evaluation failed:', e.message);
    }
    return null;
  }
}
