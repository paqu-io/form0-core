// Private conservative fast path for scalar expressions in a schema-bound record evaluator.
// Unknown calls, EVAL, arguments, member access and complex JavaScript retain full bindings.
import { parse } from 'acorn';
import { calculationBuiltins } from '../builtins/registry.js';
// These two canonical operations never consult ambient field context or invoke author callbacks.
// Other builtins keep full bindings, including math functions that can be overridden by a host.
const pureCalls = new Set(['SETRESULT', 'IF']);
export function prepareScalarBindings(code) {
  const names = new Set(),
    calls = new Set();
  function visit(node) {
    if (!node) return true;
    switch (node.type) {
      case 'Program':
        return node.body.length === 1 && visit(node.body[0]);
      case 'ExpressionStatement':
        return visit(node.expression);
      case 'Literal':
        return !node.regex;
      case 'Identifier':
        if (!node.name.startsWith('$') && !['undefined', 'NaN', 'Infinity'].includes(node.name))
          return false;
        names.add(node.name);
        return true;
      case 'UnaryExpression':
        return node.operator !== 'delete' && visit(node.argument);
      case 'BinaryExpression':
      case 'LogicalExpression':
        return visit(node.left) && visit(node.right);
      case 'ConditionalExpression':
        return visit(node.test) && visit(node.consequent) && visit(node.alternate);
      case 'CallExpression':
        if (node.optional || node.callee.type !== 'Identifier' || !pureCalls.has(node.callee.name))
          return false;
        names.add(node.callee.name);
        calls.add(node.callee.name);
        return node.arguments.every(visit);
      default:
        return false;
    }
  }
  try {
    return visit(parse(code, { ecmaVersion: 'latest' }))
      ? { names, calls, fieldCount: [...names].filter((name) => name.startsWith('$')).length }
      : null;
  } catch {
    return null;
  }
}
export function selectScalarBindings(preparation, values, helpers) {
  const plan = preparation.scalar;
  if (!plan) return null;
  for (const name of plan.calls) if (helpers[name] !== calculationBuiltins[name]) return null;
  const bindings = (preparation.scalarBindings ??= preparation.bindings.filter(([, identifier]) =>
    plan.names.has(identifier)
  ));
  // Missing/restricted names can fall through to host globals in legacy JavaScript.
  // Specialize only when every field identifier resolves to a captured primitive value.
  if (bindings.length !== plan.fieldCount) return null;
  for (const [name] of bindings)
    if (
      !Object.hasOwn(values, name) ||
      (values[name] !== null &&
        !['undefined', 'string', 'number', 'boolean', 'bigint'].includes(typeof values[name]))
    )
      return null;
  for (const name of plan.names)
    if (
      Object.hasOwn(helpers, name) &&
      helpers[name] !== calculationBuiltins[name] &&
      helpers[name] !== null &&
      !['undefined', 'string', 'number', 'boolean', 'bigint'].includes(typeof helpers[name])
    )
      return null;
  return { names: plan.names, bindings };
}
