function createContainer(value, seen) {
  if (seen.has(value)) throw new Error('Record data must not contain cyclic references.');
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new Error('Record data must use plain objects, arrays, dates or native media handles.');
  return Array.isArray(value) ? [] : {};
}

/** Clone portable record data without copying immutable binary media into JS memory. */
export function copyRecordData(value, seen = new Map()) {
  if (typeof value === 'function' || typeof value === 'symbol')
    throw new Error('Record data must not contain functions or symbols.');
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof Blob === 'function' && value instanceof Blob) return value;
  const result = createContainer(value, seen);
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

/** Copy privately captured results in bounded batches; never use this to capture live inputs. */
export async function copyRecordDataCooperatively(value, checkpoint) {
  const seen = new Map();
  const frames = [];
  function begin(source) {
    if (
      source === null ||
      typeof source !== 'object' ||
      source instanceof Date ||
      (typeof Blob === 'function' && source instanceof Blob)
    )
      return copyRecordData(source, seen);
    const target = createContainer(source, seen);
    seen.set(source, target);
    frames.push({ source, target, keys: Object.keys(source), index: 0 });
    return target;
  }
  const result = begin(value);
  let work = 0;
  while (frames.length) {
    const frame = frames[frames.length - 1];
    if (frame.index === frame.keys.length) {
      seen.delete(frame.source);
      frames.pop();
      continue;
    }
    const key = frame.keys[frame.index++];
    Object.defineProperty(frame.target, key, {
      value: begin(frame.source[key]),
      enumerable: true,
      writable: true,
      configurable: true,
    });
    if (++work === 128) {
      work = 0;
      await checkpoint();
    }
  }
  await checkpoint();
  return result;
}
