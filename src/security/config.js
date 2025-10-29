// Security modes for expression evaluation
export const SECURITY_MODES = {
  TRUSTED: 'trusted', // Full JavaScript access (current behavior)
  SAFE: 'safe', // Restricted context with whitelisted functions
  CUSTOM: 'custom', // User-defined security rules
};

// Default security configuration (TRUSTED mode - no restrictions)
export const DEFAULT_SECURITY_CONFIG = {
  mode: SECURITY_MODES.TRUSTED,
  validateBuiltins: true, // Enable builtin validation by default for performance
};

// Safe mode configuration
export const SAFE_SECURITY_CONFIG = {
  mode: SECURITY_MODES.SAFE,
  maxExecutionTime: 1000,
  maxCallStackDepth: 100,
  validateBuiltins: true, // Enable builtin validation by default for performance
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
    /\bprototype\b/,
  ],
};
