import { runExpression } from '../src/engine/evaluator.js';
import { SAFE_SECURITY_CONFIG } from '../src/security/config.js';

console.log('=== FUNCTION CONSTRUCTOR BYPASS TEST ===\n');

const testContext = { field1: 'test' };

console.log('Testing Function constructor access through global object...\n');

// Test 1: Direct global.Function access
console.log('1. Testing direct global.Function access:');
const globalFunction = runExpression('this.global.Function', testContext, SAFE_SECURITY_CONFIG);
console.log(`this.global.Function type: ${typeof globalFunction}`);
console.log(`Is it actually Function?: ${globalFunction === Function}`);

if (typeof globalFunction === 'function') {
  console.log('CRITICAL: Function constructor is accessible!');
  
  // Test if we can use it to execute code
  console.log('\n2. Testing code execution:');
  try {
    const result = globalFunction('return 42')();
    console.log(`Function('return 42')() = ${result}`);
    console.log('EXPLOIT CONFIRMED: Arbitrary code execution possible!');
  } catch (e) {
    console.log(`Function execution failed: ${e.message}`);
  }
  
  // Test accessing require through Function
  console.log('\n3. Testing require access through Function:');
  try {
    const requireAccess = globalFunction('try { return require; } catch(e) { return "no require"; }')();
    console.log(`Require access: ${typeof requireAccess} - ${requireAccess}`);
  } catch (e) {
    console.log(`Require access failed: ${e.message}`);
  }
  
  // Test process access
  console.log('\n4. Testing process access through Function:');
  try {
    const processAccess = globalFunction('try { return process; } catch(e) { return "no process"; }')();
    console.log(`Process access: ${typeof processAccess}`);
  } catch (e) {
    console.log(`Process access failed: ${e.message}`);
  }
  
  // Test file system access
  console.log('\n5. Testing file system access:');
  try {
    const fsAccess = globalFunction('try { return require("fs"); } catch(e) { return "no fs"; }')();
    console.log(`FS module access: ${typeof fsAccess}`);
  } catch (e) {
    console.log(`FS access failed: ${e.message}`);
  }
}

console.log('\n6. Alternative Function access methods:');
const altMethods = [
  'this.global["Function"]',
  'this["global"]["Function"]',
  'Object.getPrototypeOf(this.global).constructor',
  'this.global.constructor'
];

altMethods.forEach((method, i) => {
  const result = runExpression(method, testContext, SAFE_SECURITY_CONFIG);
  console.log(`Method ${i+1} (${method}): ${typeof result}`);
});

console.log('\n=== FUNCTION BYPASS TEST COMPLETE ===');
