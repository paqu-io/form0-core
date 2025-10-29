import { runExpression } from '../src/engine/evaluator.js';
import { SAFE_SECURITY_CONFIG } from '../src/security/config.js';

console.log('=== SAFE Mode Bypass Analysis ===\n');

// Test context to work with
const testContext = {
  field1: 'test',
  field2: 42,
  Math: Math,
  String: String,
  Number: Number,
  Array: Array,
  Object: Object
};

function testBypass(description, expression) {
  console.log(`\n--- ${description} ---`);
  console.log(`Expression: ${expression}`);
  
  try {
    const result = runExpression(expression, testContext, SAFE_SECURITY_CONFIG);
    
    if (result === null || result === undefined) {
      console.log('✓ BLOCKED: Expression returned null/undefined');
    } else {
      console.log(`✗ BYPASS SUCCESS: Result = ${JSON.stringify(result)}`);
      
      // Additional analysis
      if (typeof result === 'function') {
        console.log('  WARNING: Got function object - potential code execution');
      }
      if (typeof result === 'object' && result !== null) {
        console.log('  INFO: Got object - analyzing...');
        if (result.constructor && result.constructor.name) {
          console.log(`  Object type: ${result.constructor.name}`);
        }
      }
    }
  } catch (error) {
    console.log(`✓ BLOCKED: Error - ${error.message}`);
  }
}

console.log('1. Character Encoding Bypasses');
testBypass('Unicode eval', 'e\u0076al("42")');
testBypass('Hex escape eval', '\\x65val("42")');

console.log('\n2. Property Access Bypasses');
testBypass('Bracket notation eval', 'this["ev" + "al"]("42")');
testBypass('Computed property', 'window["e" + "val"]("42")');

console.log('\n3. String Method Bypasses');
testBypass('String fromCharCode', 'String.fromCharCode(101,118,97,108)("42")');
testBypass('Template literal', '`${"ev"}${"al"}`("42")');

console.log('\n4. Array Method Bypasses');
testBypass('Array join', '["e","v","a","l"].join("")("42")');
testBypass('Split reverse join', '"lave".split("").reverse().join("")("42")');

console.log('\n5. Context Manipulation');
testBypass('Access allowed globals', 'Math.constructor("return 42")()');
testBypass('String constructor chain', 'String.constructor("return 42")()');
testBypass('Array constructor chain', 'Array.constructor("return 42")()');

console.log('\n6. Function Reference Bypasses');
testBypass('Indirect function call', '(function(){return eval})()("42")');
testBypass('Function.prototype.call', 'Math.max.constructor("return 42")()');

console.log('\n7. Global Object Access');
testBypass('Global this binding', '(function(){return this})()');
testBypass('Indirect global', '(0,eval)("this")');
testBypass('Global through error', 'try{null.f()}catch(e){e.constructor.constructor("return this")()}');

console.log('\n8. Prototype Chain Exploitation');
testBypass('toString constructor', '(42).toString.constructor("return 42")()');
testBypass('valueOf constructor', '({}).valueOf.constructor("return 42")()');

console.log('\n9. Symbol and Reflection (if available)');
testBypass('Symbol.for', 'Symbol.for("Symbol.iterator")');
testBypass('Reflect.construct', 'Reflect.construct(Array, [])');

console.log('\n10. Async and Generator Bypasses');
testBypass('Generator function', '(function*(){yield 42})().next()');
testBypass('Promise executor', 'new Promise(r=>r(42))');

console.log('\n11. Advanced Context Escape');
// Check if we can access the original context
testBypass('Arguments object', 'arguments');
testBypass('Caller property', 'testBypass.caller');
testBypass('Function length', 'Math.max.length');

console.log('\n12. Pattern Evasion Techniques');
testBypass('Case variation', 'EVAL("42")'); // Uppercase might not be blocked
testBypass('Space injection', 'ev al("42")'); // Won't work but testing pattern
testBypass('Comment injection', 'eval/*comment*/("42")');

console.log('\n13. Testing Allowed Globals Safety');
testBypass('Math constructor', 'Math.constructor');
testBypass('String constructor', 'String.constructor');
testBypass('Number constructor', 'Number.constructor');

console.log('\n=== Bypass Analysis Complete ===');
