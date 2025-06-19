import { __consumeResult } from './helpers/builtins.js';

export function runExpression(expr, context = {}) {
  const keys = Object.keys(context);
  const values = Object.values(context);

  try {
    const fn = new Function(...keys, `return (${expr});`);
    const result = fn(...values);
    const consumed = __consumeResult();
    return consumed.called ? consumed.value : result;
  } catch (e) {
    console.warn('[form0] Expression evaluation failed:', e.message);
    return null;
  }
}

