/** Defensive portable event data, including immutable native media handles. */
export function copyEventData(value, seen = new Map()) {
  if (typeof value === 'function' || typeof value === 'symbol')
    throw new TypeError('Event data must not contain functions or symbols.');
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof File === 'function' && value instanceof File)
    return new File([value], value.name, { type: value.type, lastModified: value.lastModified });
  if (typeof Blob === 'function' && value instanceof Blob)
    return Blob.prototype.slice.call(value, 0, value.size, value.type);
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new TypeError(
      'Event data must use plain objects, arrays, dates or native media handles.'
    );
  const result = Array.isArray(value) ? [] : {};
  seen.set(value, result);
  for (const key of Object.keys(value))
    Object.defineProperty(result, key, {
      value: copyEventData(value[key], seen),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  return result;
}
