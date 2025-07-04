// Security modes for expression evaluation
export const SECURITY_MODES = {
  TRUSTED: 'trusted',    // Full JavaScript access (current behavior)
  SAFE: 'safe',         // Restricted context with whitelisted functions
  CUSTOM: 'custom'      // User-defined security rules
};

// Default security configuration (TRUSTED mode - no restrictions)
export const DEFAULT_SECURITY_CONFIG = {
  mode: SECURITY_MODES.TRUSTED
};

// Safe mode configuration
export const SAFE_SECURITY_CONFIG = {
  mode: SECURITY_MODES.SAFE,
  maxExecutionTime: 1000,
  maxCallStackDepth: 100,
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

export function validateExpression(expr, securityConfig = DEFAULT_SECURITY_CONFIG) {
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