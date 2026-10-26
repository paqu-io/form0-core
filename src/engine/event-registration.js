import { parse } from 'acorn';
import { ON } from '../builtins/event/control/on.js';

/**
 * Canonical ON calls with literal routes only create handlers; their bodies are not executed.
 * Anything else needs the complete initialization context. Do not restrict handler body syntax.
 */
export function isLiteralEventRegistration(code, on) {
  if (on !== ON || typeof code !== 'string') return false;
  try {
    const tree = parse(code, { ecmaVersion: 'latest', sourceType: 'commonjs' });
    return (
      tree.body.length > 0 &&
      tree.body.every((statement) => {
        const call = statement.expression;
        if (
          statement.type !== 'ExpressionStatement' ||
          call.type !== 'CallExpression' ||
          call.optional ||
          call.callee.type !== 'Identifier' ||
          call.callee.name !== 'ON' ||
          ![2, 3].includes(call.arguments.length)
        )
          return false;
        const callback = call.arguments.at(-1);
        return (
          ['FunctionExpression', 'ArrowFunctionExpression'].includes(callback.type) &&
          call.arguments
            .slice(0, -1)
            .every((argument) => argument.type === 'Literal' && typeof argument.value === 'string')
        );
      })
    );
  } catch {
    // Existing validation/execution owns syntax diagnostics.
    return false;
  }
}
