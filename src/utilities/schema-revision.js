function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])])
  );
}

function fnv1a64(input) {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

/** Return a deterministic schema revision without importing authoring/editor modules. */
export function getFormSchemaRevision(schema) {
  const root =
    schema?.form && Array.isArray(schema.form.elements)
      ? schema
      : schema && Array.isArray(schema.elements)
        ? { form: schema }
        : null;
  if (!root) throw new Error('Expected a root schema containing form.elements or a form schema');
  return `form0-${fnv1a64(JSON.stringify(stableValue(root)))}`;
}
