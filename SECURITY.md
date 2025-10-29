# Security Features

form0-core provides configurable security options for expression evaluation to balance flexibility and safety.

## Security Modes

### TRUSTED (Default)

- **Full JavaScript access** - Current behavior maintained
- **No restrictions** - All expressions execute as-is
- **Use case**: Internal tools, trusted developers, client-side only

```javascript
import { createFormEngine } from 'form0-core';

// Default behavior - no security parameter needed
const engine = createFormEngine({ schema });

// Or explicitly set trusted mode
const engine = createFormEngine({
  schema,
  security: { mode: 'trusted' },
});
```

### SAFE

- **Restricted context** - Only whitelisted globals available
- **Pattern blocking** - Dangerous patterns are blocked
- **Use case**: User-generated expressions, safer environments

```javascript
import { createFormEngine, SECURITY_MODES, SAFE_SECURITY_CONFIG } from 'form0-core';

// Simple safe mode
const engine = createFormEngine({
  schema,
  security: { mode: SECURITY_MODES.SAFE },
});

// Or use predefined safe config
const engine = createFormEngine({
  schema,
  security: SAFE_SECURITY_CONFIG,
});
```

### CUSTOM

- **User-defined rules** - Configure your own security settings
- **Flexible restrictions** - Mix and match security features
- **Use case**: Specific security requirements

```javascript
const engine = createFormEngine({
  schema,
  security: {
    mode: SECURITY_MODES.CUSTOM,
    maxExecutionTime: 1000,
    allowedGlobals: ['Math', 'Date', 'Number'],
    blockedPatterns: [/\bwindow\b/, /\bdocument\b/, /\bfetch\b/],
  },
});
```

## Security Configuration Options

```javascript
// TRUSTED mode (default) - no additional config needed
const trustedConfig = {
  mode: 'trusted', // Full JavaScript access
};

// SAFE mode - uses predefined safe settings
const safeConfig = {
  mode: 'safe', // Automatically applies safe defaults
};

// CUSTOM mode - define your own rules
const customConfig = {
  mode: 'custom',
  maxExecutionTime: 1000, // Milliseconds (future feature)
  maxCallStackDepth: 100, // Maximum recursion depth (future feature)
  allowedGlobals: ['Math', 'Date', 'JSON'], // Whitelisted global objects
  blockedPatterns: [/\beval\b/, /\bwindow\b/], // Regex patterns to block
};
```

## Default Blocked Patterns (Safe Mode)

The following patterns are blocked by default in safe mode:

- `eval`, `Function` - Code execution
- `window`, `document` - Browser globals
- `process`, `require` - Node.js globals
- `fetch`, `XMLHttpRequest` - Network requests
- `localStorage`, `sessionStorage` - Storage APIs
- `__proto__`, `constructor`, `prototype` - Prototype pollution

## Migration Guide

### No Changes Needed

Existing code continues to work unchanged:

```javascript
// This still works exactly as before
const engine = createFormEngine({ schema, initialValues });
```

### Adding Security

To add security, simply include the security parameter:

```javascript
// Add safe mode
const engine = createFormEngine({
  schema,
  initialValues,
  security: { mode: 'safe' },
});
```

## Examples

### Safe Mathematical Calculations

```javascript
const schema = {
  form: {
    elements: [
      {
        type: 'CalculatedField',
        data_name: 'result',
        calculate: 'Math.max($value1, $value2) * 1.1', // ✅ Works in safe mode
      },
    ],
  },
};
```

### Blocked Dangerous Expressions

```javascript
const schema = {
  form: {
    elements: [
      {
        type: 'CalculatedField',
        data_name: 'result',
        calculate: 'window.alert("hello")', // ❌ Blocked in safe mode
      },
    ],
  },
};
```

### Custom Security Rules

```javascript
const engine = createFormEngine({
  schema,
  security: {
    mode: 'custom',
    allowedGlobals: ['Math'], // Only Math allowed
    blockedPatterns: [/\bDate\b/], // Block Date usage
  },
});
```

## Testing Security

Use the included test file to verify security behavior:

```bash
node test/security-test.js
```

This will show how different expressions behave under different security modes.
