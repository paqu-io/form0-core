import { createFormEngine, SECURITY_MODES, SAFE_SECURITY_CONFIG } from '../src/index.js';

const testSchema = {
  form: {
    name: 'SecurityTest',
    elements: [
      {
        type: 'NumericField',
        key: 'age1',
        data_name: 'age',
        label: 'Age',
        required: true,
      },
      {
        type: 'CalculatedField',
        key: 'calc1',
        data_name: 'safe_calc',
        label: 'Safe Calculation',
        calculate: 'Math.max($age, 18)',
        display: { style: 'numeric' },
      },
      {
        type: 'CalculatedField',
        key: 'calc2',
        data_name: 'unsafe_calc',
        label: 'Unsafe Calculation',
        calculate: 'window.alert("This should be blocked")',
        display: { style: 'text' },
      },
      {
        type: 'CalculatedField',
        key: 'calc3',
        data_name: 'builtin_calc',
        label: 'Built-in Calculation',
        calculate: 'IF($age >= 18, "Adult", "Minor")',
        display: { style: 'text' },
      }
    ]
  }
};

console.log('=== Testing Security Implementation ===\n');

// Test 1: Trusted mode (default - current behavior)
console.log('1. TRUSTED MODE (default):');
const trustedEngine = createFormEngine({ 
  schema: testSchema, 
  initialValues: { age: 25 }
});
trustedEngine.eval();
console.log('State:', trustedEngine.getState());
console.log('');

// Test 2: Safe mode (simple)
console.log('2. SAFE MODE (simple):');
const safeEngine = createFormEngine({ 
  schema: testSchema, 
  initialValues: { age: 25 },
  security: { mode: SECURITY_MODES.SAFE }
});
safeEngine.eval();
console.log('State:', safeEngine.getState());
console.log('');

// Test 2b: Safe mode (using predefined config)
console.log('2b. SAFE MODE (using predefined config):');
const safeEngine2 = createFormEngine({ 
  schema: testSchema, 
  initialValues: { age: 25 },
  security: SAFE_SECURITY_CONFIG
});
safeEngine2.eval();
console.log('State:', safeEngine2.getState());
console.log('');

// Test 3: Custom mode with specific restrictions
console.log('3. CUSTOM MODE:');
const customEngine = createFormEngine({ 
  schema: testSchema, 
  initialValues: { age: 25 },
  security: { 
    mode: SECURITY_MODES.CUSTOM,
    maxExecutionTime: 500,
    allowedGlobals: ['Math', 'Date'],
    blockedPatterns: [/\bwindow\b/, /\balert\b/]
  }
});
customEngine.eval();
console.log('State:', customEngine.getState());
console.log('');

console.log('=== Security Test Complete ==='); 