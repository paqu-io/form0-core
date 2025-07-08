import { builtins, eventBuiltins } from '../helpers/builtins.js';

// Security modes for expression evaluation
export const SECURITY_MODES = {
  TRUSTED: 'trusted',    // Full JavaScript access (current behavior)
  SAFE: 'safe',         // Restricted context with whitelisted functions
  CUSTOM: 'custom'      // User-defined security rules
};

// Default security configuration (TRUSTED mode - no restrictions)
export const DEFAULT_SECURITY_CONFIG = {
  mode: SECURITY_MODES.TRUSTED,
  validateBuiltins: true  // Enable builtin validation by default for performance
};

// Safe mode configuration
export const SAFE_SECURITY_CONFIG = {
  mode: SECURITY_MODES.SAFE,
  maxExecutionTime: 1000,
  maxCallStackDepth: 100,
  validateBuiltins: true,  // Enable builtin validation by default for performance
  allowedGlobals: ['Math', 'Date', 'JSON', 'Number', 'String', 'Array', 'Object'],
  blockedPatterns: [
    /\beval\b/,
    /\bFunction\b/,
    /\bwindow\b/,
    /\bdocument\b/,
    /\bprocess\b/,
    /\brequire\b/,
    /\bimport\b/,
    /\bfetch\b/,
    /\bXMLHttpRequest\b/,
    /\blocalStorage\b/,
    /\bsessionStorage\b/,
    /\b__proto__\b/,
    /\bconstructor\b/,
    /\bprototype\b/
  ]
};

// Cache valid builtins as a Set for O(1) lookups
let validBuiltinsSet = null;
let validEventBuiltinsSet = null;

// Helper function to validate builtin function names in expressions
function validateBuiltinNames(expr, includeEventBuiltins = false) {
  // Lazy initialization of valid builtins set
  if (!validBuiltinsSet) {
    validBuiltinsSet = new Set(Object.keys(builtins));
  }
  
  // Lazy initialization of valid event builtins set
  if (!validEventBuiltinsSet) {
    validEventBuiltinsSet = new Set(Object.keys(eventBuiltins));
  }
  
  // Combine regular and event builtins if in event context
  const allowedBuiltins = includeEventBuiltins 
    ? new Set([...validBuiltinsSet, ...validEventBuiltinsSet])
    : validBuiltinsSet;
  
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
    const commonFunctions = ['Math', 'Date', 'JSON', 'Number', 'String', 'Array', 'Object', 'Boolean'];
    if (commonFunctions.includes(functionName)) {
      continue;
    }
    
    // Skip special event functions when in event context
    if (includeEventBuiltins && functionName === 'ON') {
      continue;
    }
    
    // Check for potential typos by finding similar builtin names
    const validBuiltins = [...allowedBuiltins]; // Convert back to array for filtering
    const similarBuiltins = validBuiltins.filter(builtin => {
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
      reason: `Unknown builtin function: ${functionName}.${suggestion}`
    };
  }
  
  return { valid: true };
}

export function validateExpression(expr, securityConfig = DEFAULT_SECURITY_CONFIG, includeEventBuiltins = false) {
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
  const config = securityConfig.mode === SECURITY_MODES.SAFE && !securityConfig.blockedPatterns
    ? SAFE_SECURITY_CONFIG
    : securityConfig;

  // Check for blocked patterns
  if (config.blockedPatterns) {
    for (const pattern of config.blockedPatterns) {
      if (pattern.test(expr)) {
        return { 
          valid: false, 
          reason: `Expression contains blocked pattern: ${pattern.source}` 
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
  const config = securityConfig.mode === SECURITY_MODES.SAFE && !securityConfig.allowedGlobals
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