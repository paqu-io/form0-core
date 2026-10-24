// Owned by the supplied compilation cache. Keep parameter names and functions only;
// never retain record values, helper closures, permissions or diagnostic callbacks.
const layoutsByCache = new WeakMap();

export function compileExpression(code, context, mode, cache) {
  const incomingKeys = Object.keys(context);
  const body = mode === 'body' ? code : `return (${code});`;
  if (!cache) return { keys: incomingKeys, fn: new Function(...incomingKeys, body) };

  let expressions = layoutsByCache.get(cache);
  if (!expressions) {
    expressions = new Map();
    layoutsByCache.set(cache, expressions);
  }
  const expressionKey = JSON.stringify([mode, code]);
  const layouts = expressions.get(expressionKey) || [];
  const index = layouts.findIndex(
    (layout) =>
      layout.incomingKeys.length === incomingKeys.length &&
      layout.incomingKeys.every((key, position) => key === incomingKeys[position])
  );
  const existing = layouts[index];
  // Respect explicit clearing/replacement of the caller-owned compilation cache.
  if (existing && cache.get(existing.cacheKey) === existing.fn) return existing;

  const keys = [...incomingKeys].sort();
  const cacheKey = JSON.stringify([mode, keys, code]);
  const fn = cache.get(cacheKey) ?? new Function(...keys, body);
  cache.set(cacheKey, fn);
  const layout = { incomingKeys, keys, cacheKey, fn };
  const replacement =
    index >= 0 ? index : layouts.findIndex((entry) => entry.cacheKey === cacheKey);
  if (replacement >= 0) layouts[replacement] = layout;
  else {
    layouts.push(layout);
  }
  expressions.set(expressionKey, layouts);
  return layout;
}
