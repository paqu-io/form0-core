import { createFormEngine } from '../src/index.js';
import { SAFE_SECURITY_CONFIG, DEFAULT_SECURITY_CONFIG } from '../src/security/config.js';
import { validateExpression } from '../src/security/validation.js';
import { runExpression } from '../src/engine/evaluator.js';

console.log('=== SAFE Mode Security Analysis ===\n');

// Test 1: Direct expression validation
console.log('1. Expression Validation Tests');
console.log('===============================');

const testExpressions = [
  { expr: 'eval("42")', desc: 'Direct eval()' },
  { expr: 'Function("return 42")()', desc: 'Function constructor' },
  { expr: 'process.exit(1)', desc: 'Process access' },
  { expr: 'window.location', desc: 'Window access' },
  { expr: 'document.body', desc: 'Document access' },
  { expr: '__proto__.admin = true', desc: 'Prototype pollution' },
  { expr: 'constructor.constructor("return 42")()', desc: 'Constructor chain' },
  { expr: '1 + 2', desc: 'Safe math' },
  { expr: 'Math.max(1, 2)', desc: 'Math object' },
  { expr: '"Hello " + "World"', desc: 'String concat' }
];

testExpressions.forEach(({ expr, desc }) => {
  const validation = validateExpression(expr, SAFE_SECURITY_CONFIG);
  console.log(`${desc}: ${validation.valid ? '✗ ALLOWED' : '✓ BLOCKED'}`);
  if (!validation.valid) {
    console.log(`  Reason: ${validation.reason}`);
  }
});

console.log('\n2. Expression Execution Tests');
console.log('==============================');

// Test 2: Direct expression execution
function testExecution(expr, desc, shouldWork = false) {
  try {
    const result = runExpression(expr, { testField: 'testValue' }, SAFE_SECURITY_CONFIG);
    if (shouldWork) {
      console.log(`${desc}: ✓ ALLOWED (result: ${JSON.stringify(result)})`);
    } else {
      console.log(`${desc}: ${result === null ? '✓ BLOCKED' : '✗ NOT BLOCKED'} (result: ${JSON.stringify(result)})`);
    }
  } catch (error) {
    console.log(`${desc}: ${shouldWork ? '✗ ERROR' : '✓ BLOCKED'} (${error.message})`);
  }
}

testExecution('eval("42")', 'Direct eval()');
testExecution('Function("return 42")()', 'Function constructor');
testExecution('process.exit', 'Process access');
testExecution('this.constructor', 'This constructor');
testExecution('1 + 2', 'Safe math', true);
testExecution('Math.PI', 'Math constant', true);
testExecution('"Hello"', 'String literal', true);

console.log('\n3. Context Analysis');
console.log('===================');

// Test 3: Analyze what's available in SAFE mode context
const context = { field1: 'value1', helper: () => 'help' };
const safeContext = runExpression('typeof Math + " " + typeof eval + " " + typeof Function', context, SAFE_SECURITY_CONFIG);
console.log(`Safe context types: ${safeContext}`);

console.log('\n4. EVAL Builtin Tests');
console.log('======================');

// Test 4: Test EVAL builtin specifically
import { EVAL } from '../src/builtins/control/eval.js';
import { __setEvalContext } from '../src/builtins/control/eval.js';

// Set up context for EVAL
__setEvalContext({ field1: 'test', field2: 42 });

const evalTests = [
  { expr: 'eval("42")', desc: 'EVAL with eval' },
  { expr: 'Function("return 42")()', desc: 'EVAL with Function' },
  { expr: 'process.exit(1)', desc: 'EVAL with process' },
  { expr: '1 + 2', desc: 'EVAL safe math' },
  { expr: '$field1', desc: 'EVAL field reference' }
];

evalTests.forEach(({ expr, desc }) => {
  try {
    const result = EVAL(expr);
    console.log(`${desc}: ${result === null ? '✓ BLOCKED' : result !== null ? `✓ ALLOWED (${JSON.stringify(result)})` : '? UNKNOWN'}`);
  } catch (error) {
    console.log(`${desc}: ✓ BLOCKED (${error.message})`);
  }
});

console.log('\n5. Bypass Attempt Analysis');
console.log('===========================');

// Test 5: Advanced bypass attempts
const bypassAttempts = [
  // String-based bypasses
  '"eval"["call"](null, "42")',
  '(0, eval)("42")',
  'globalThis["eval"]("42")',
  
  // Constructor chain bypasses
  '""["constructor"]["constructor"]("return 42")()',
  '[]["constructor"]["constructor"]("return 42")()',
  '({}["constructor"]["constructor"]("return this")())',
  
  // Prototype chain bypasses
  'String["prototype"]["constructor"]("return 42")()',
  'Array["prototype"]["constructor"]["constructor"]("return 42")()',
  
  // Context escape attempts
  'arguments["callee"]["constructor"]("return 42")()',
  'this["constructor"]["constructor"]("return 42")()',
];

bypassAttempts.forEach(expr => {
  const validation = validateExpression(expr, SAFE_SECURITY_CONFIG);
  const execution = validation.valid ? runExpression(expr, {}, SAFE_SECURITY_CONFIG) : null;
  
  console.log(`Bypass attempt: ${expr.substring(0, 40)}...`);
  console.log(`  Validation: ${validation.valid ? '✗ PASSED' : '✓ BLOCKED'}`);
  if (validation.valid && execution !== null && execution !== undefined) {
    console.log(`  Execution: ✗ SUCCESSFUL (${JSON.stringify(execution)})`);
  } else {
    console.log(`  Execution: ✓ BLOCKED`);
  }
});

console.log('\n=== Analysis Complete ===');
