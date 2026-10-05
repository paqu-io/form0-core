import {
  CALCULATION_BUILTIN_DEFINITIONS,
  EVENT_BUILTIN_DEFINITIONS,
} from '../builtins/builtin-definitions.js';
import { DEFAULT_SECURITY_CONFIG, SAFE_SECURITY_CONFIG, SECURITY_MODES } from './config.js';

// Helper function to validate builtin function names in expressions
function validateBuiltinNames(expr, includeEventBuiltins = false) {
  // Read the same immutable catalog used to build the runtime helpers, without
  // importing their implementations (EVAL itself depends on this validator).
  const definitions = includeEventBuiltins
    ? EVENT_BUILTIN_DEFINITIONS
    : CALCULATION_BUILTIN_DEFINITIONS;
  const allowedBuiltins = new Set(definitions.map(({ name }) => name));

  // Extract function calls from the expression
  // This regex matches function calls like FUNCTIONNAME( allowing for whitespace
  const functionCallPattern = /\b([A-Z_][A-Z0-9_]*)\s*\(/g;
  const matches = [...expr.matchAll(functionCallPattern)];

  for (const match of matches) {
    const functionName = match[1];

    // Skip if it's a valid builtin
    if (allowedBuiltins.has(functionName)) {
      continue;
    }

    // Skip common JavaScript functions/objects that might be uppercase
    const commonFunctions = [
      'Math',
      'Date',
      'JSON',
      'Number',
      'String',
      'Array',
      'Object',
      'Boolean',
    ];
    if (commonFunctions.includes(functionName)) {
      continue;
    }

    // Skip special event functions when in event context
    if (includeEventBuiltins && functionName === 'ON') {
      continue;
    }

    // Check for potential typos by finding similar builtin names
    const validBuiltinNames = [...allowedBuiltins];
    const similarBuiltins = validBuiltinNames.filter((builtin) => {
      // Simple similarity check - same length or very close
      const lengthDiff = Math.abs(builtin.length - functionName.length);
      return lengthDiff <= 2 && builtin.startsWith(functionName.substring(0, 3));
    });

    let suggestion = '';
    if (similarBuiltins.length > 0) {
      suggestion = ` Did you mean ${similarBuiltins[0]}?`;
    }

    return {
      valid: false,
      reason: `Unknown builtin function: ${functionName}.${suggestion}`,
    };
  }

  return { valid: true };
}

export function validateExpression(
  expr,
  securityConfig = DEFAULT_SECURITY_CONFIG,
  includeEventBuiltins = false
) {
  // Only validate builtin names if explicitly enabled
  if (securityConfig.validateBuiltins === true) {
    const builtinValidation = validateBuiltinNames(expr, includeEventBuiltins);
    if (!builtinValidation.valid) {
      return builtinValidation;
    }
  }

  if (securityConfig.mode === SECURITY_MODES.TRUSTED) {
    return { valid: true };
  }

  // For SAFE mode, use default patterns if none provided
  const config =
    securityConfig.mode === SECURITY_MODES.SAFE && !securityConfig.blockedPatterns
      ? SAFE_SECURITY_CONFIG
      : securityConfig;

  // Check for blocked patterns
  if (config.blockedPatterns) {
    for (const pattern of config.blockedPatterns) {
      if (pattern.test(expr)) {
        return {
          valid: false,
          reason: `Expression contains blocked pattern: ${pattern.source}`,
        };
      }
    }
  }

  return { valid: true };
}

export function createSecureContext(context, securityConfig = DEFAULT_SECURITY_CONFIG) {
  if (securityConfig.mode === SECURITY_MODES.TRUSTED) {
    return context; // Return original context for trusted mode
  }

  // For SAFE mode, use default globals if none provided
  const config =
    securityConfig.mode === SECURITY_MODES.SAFE && !securityConfig.allowedGlobals
      ? SAFE_SECURITY_CONFIG
      : securityConfig;

  // Create restricted context for safe mode
  const secureContext = {};

  // Add allowed globals
  if (config.allowedGlobals) {
    for (const globalName of config.allowedGlobals) {
      if (typeof window !== 'undefined' && window[globalName]) {
        secureContext[globalName] = window[globalName];
      } else if (typeof global !== 'undefined' && global[globalName]) {
        secureContext[globalName] = global[globalName];
      }
    }
  }

  // Add user context (field values and helpers)
  Object.assign(secureContext, context);

  return secureContext;
}

export function withTimeout(fn, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Expression execution timed out after ${timeout}ms`));
    }, timeout);

    try {
      const result = fn();
      clearTimeout(timer);
      resolve(result);
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}
