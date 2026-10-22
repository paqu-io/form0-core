/** Clone portable record data without copying immutable binary media into JS memory. */
export function copyRecordData(value, seen = new Map()) {
  if (typeof value === 'function' || typeof value === 'symbol')
    throw new Error('Record data must not contain functions or symbols.');
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) throw new Error('Record data must not contain cyclic references.');
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof Blob === 'function' && value instanceof Blob) return value;
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new Error('Record data must use plain objects, arrays, dates or native media handles.');
  const result = Array.isArray(value) ? [] : {};
  seen.set(value, result);
  for (const key of Object.keys(value)) {
    Object.defineProperty(result, key, {
      value: copyRecordData(value[key], seen),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  seen.delete(value);
  return result;
}
