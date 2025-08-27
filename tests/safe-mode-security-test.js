import { createFormEngine } from '../src/index.js';
import { SAFE_SECURITY_CONFIG } from '../src/security/config.js';

console.log('=== SAFE Mode Security Analysis ===\n');

// Test schema for security testing
const testSchema = {
  fields: [
    {
      name: 'test_field',
      type: 'TextField',
      calculated: true,
      expression: 'placeholder' // Will be replaced by tests
    },
    {
      name: 'normal_field',
      type: 'TextField'
    }
  ]
};

function testExpression(description, expression, shouldSucceed = false) {
  console.log(`\n--- ${description} ---`);
  console.log(`Expression: ${expression}`);
  
  try {
    const schema = {
      ...testSchema,
      fields: [
        {
          ...testSchema.fields[0],
          expression: expression
        },
        testSchema.fields[1]
      ]
    };
    
    const engine = createFormEngine({
      schema,
      initialValues: { normal_field: 'test' },
      security: SAFE_SECURITY_CONFIG
    });
    
    const result = engine.eval();
    const testFieldValue = result.values.test_field;
    
    if (shouldSucceed) {
      console.log(`✓ PASS: Result = ${JSON.stringify(testFieldValue)}`);
    } else {
      if (testFieldValue === null || testFieldValue === undefined) {
        console.log(`✓ PASS: Expression blocked (result = ${testFieldValue})`);
      } else {
        console.log(`✗ FAIL: Expression not blocked! Result = ${JSON.stringify(testFieldValue)}`);
      }
    }
  } catch (error) {
    if (shouldSucceed) {
      console.log(`✗ FAIL: Unexpected error - ${error.message}`);
    } else {
      console.log(`✓ PASS: Expression blocked with error - ${error.message}`);
    }
  }
}

console.log('1. SAFE Mode Basic Protections');
testExpression('Direct eval() call', 'eval("Math.random()")');
testExpression('Function constructor', 'Function("return 42")()');
testExpression('Process access', 'process.exit(1)');
testExpression('Window access', 'window.location.href');
testExpression('Document access', 'document.createElement("script")');
testExpression('Fetch access', 'fetch("http://evil.com")');
testExpression('Constructor access', '"".constructor');
testExpression('Prototype pollution', '__proto__.isAdmin = true');

console.log('\n\n2. JavaScript Code Injection Attempts');
testExpression('Function in string', '"test"; Function("return 42")(); "');
testExpression('Eval in string', '"hello"; eval("42"); "world"');
testExpression('Semicolon injection', '"test"; process.exit(1); "safe"');
testExpression('Newline injection', '"test";\nprocess.exit(1);\n"safe"');

console.log('\n\n3. Context Escape Attempts');
testExpression('This binding', 'this.constructor.constructor("return 42")()');
testExpression('Global access via this', 'this.global.process');
testExpression('Arguments escape', 'arguments.callee.constructor("return 42")()');

console.log('\n\n4. EVAL Builtin Security');
testExpression('EVAL with eval', 'EVAL("eval(\\"Math.random()\\")")');
testExpression('EVAL with Function', 'EVAL("Function(\\"return 42\\")()")');
testExpression('EVAL with process', 'EVAL("process.exit(1)")');
testExpression('EVAL nested eval', 'EVAL("EVAL(\\"process.exit(1)\\")")');

console.log('\n\n5. Allowed Safe Operations');
testExpression('Basic math', '1 + 2 + 3', true);
testExpression('String operations', '"Hello " + "World"', true);
testExpression('Math object', 'Math.max(1, 2, 3)', true);
testExpression('Field reference', '$normal_field', true);
testExpression('EVAL safe expression', 'EVAL("1 + 2")', true);

console.log('\n\n6. Global Object Access Attempts');
testExpression('Global via constructor', '({}).constructor.constructor("return this")()');
testExpression('Global via toString', '({}).toString.constructor.constructor("return this")()');
testExpression('Global via valueOf', '({}).valueOf.constructor.constructor("return this")()');

console.log('\n\n7. Prototype Chain Attacks');
testExpression('String prototype', 'String.prototype.constructor("return 42")()');
testExpression('Array prototype', 'Array.prototype.constructor.constructor("return 42")()');
testExpression('Object prototype', 'Object.prototype.constructor.constructor("return 42")()');

console.log('\n\n8. Symbol and Reflection Attacks');
testExpression('Symbol.for access', 'Symbol.for("nodejs.util.inspect.custom")');
testExpression('Reflect construct', 'Reflect.construct(Function, ["return 42"])()');

console.log('\n\n9. Async/Promise Bypass Attempts');
testExpression('Promise constructor', 'Promise.resolve().constructor("return 42")()');
testExpression('Async function', '(async () => { return 42; })()');

console.log('\n\n10. Template Literal Attacks');
testExpression('Template literal', '`${eval("42")}`');
testExpression('Tagged template', 'String.raw`${Function("return 42")()}`');

console.log('\n\nSAFE Mode Security Test Complete');
