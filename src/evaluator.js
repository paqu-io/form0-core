import { __consumeResult } from './helpers/builtins.js';
import { 
  validateExpression, 
  createSecureContext, 
  withTimeout,
  DEFAULT_SECURITY_CONFIG 
} from './utils/security.js';

export function runExpression(expr, context = {}, securityConfig = DEFAULT_SECURITY_CONFIG, includeEventBuiltins = false) {
  try {
    // Validate expression based on security mode
    const validation = validateExpression(expr, securityConfig, includeEventBuiltins);
    if (!validation.valid) {
      console.warn('[form0] Expression validation failed:', validation.reason);
      return null;
    }

    // Create secure context based on security mode
    const secureContext = createSecureContext(context, securityConfig);
    const keys = Object.keys(secureContext);
    const values = Object.values(secureContext);

    // Execute expression
    const executeExpression = () => {
      // Handle both expressions and multi-line code (Windows-safe)
      const isMultiLine = expr.includes('\r\n') || expr.includes('\n') || expr.includes('function');
      
      if (isMultiLine) {
        // Execute as code block (recompile each time for now)
        const fn = new Function(...keys, expr);
        const result = fn(...values);
        // Check for consumed result from SETRESULT() calls in multiline code
        const consumed = __consumeResult();
        return consumed.called ? consumed.value : result;
      } else {
        // Execute as expression (existing behavior)
        const fn = new Function(...keys, `return (${expr});`);
        const result = fn(...values);
        const consumed = __consumeResult();
        return consumed.called ? consumed.value : result;
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
    console.warn('[form0] Expression evaluation failed:', e.message);
    return null;
  }
}
