import { __consumeResult } from './helpers/builtins.js';
import { 
  validateExpression, 
  createSecureContext, 
  withTimeout,
  DEFAULT_SECURITY_CONFIG 
} from './utils/security.js';

export function runExpression(expr, context = {}, securityConfig = DEFAULT_SECURITY_CONFIG) {
  try {
    // Validate expression based on security mode
    const validation = validateExpression(expr, securityConfig);
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
      const fn = new Function(...keys, `return (${expr});`);
      const result = fn(...values);
      const consumed = __consumeResult();
      return consumed.called ? consumed.value : result;
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
