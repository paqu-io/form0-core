import { __consumeResult } from './helpers/builtins.js';

// let vm = null;

// // Load `vm` module only if in a Node.js environment
// if (typeof process !== 'undefined' && process.versions?.node) {
//   try {
//     const { createRequire } = await import('module');
//     const require = createRequire(import.meta.url);
//     vm = require('vm');
//   } catch (e) {
//     // Fallback will be used
//   }
// }

// export function runExpression(expr, context = {}) {
//   // If Node.js vm is available, use it (CLI/Node only)
//   if (vm) {
//     const sandbox = { ...context };
//     const script = new vm.Script(expr);
//     const contextified = vm.createContext(sandbox);
//     const result = script.runInContext(contextified);
//     const consumed = __consumeResult();
//     return consumed.called ? consumed.value : result;
//   }

//   // Browser-safe fallback
//   const keys = Object.keys(context);
//   const values = Object.values(context);
//   const fn = new Function(...keys, `return (${expr});`);
//   const result = fn(...values);
//   const consumed = __consumeResult();
//   return consumed.called ? consumed.value : result;
// }

// 🚫 Remove VM logic entirely – RN doesn't support it
// This fallback works for browser + RN
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

