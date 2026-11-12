function isPlainObject(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return Object.prototype.toString.call(value) === '[object Object]';
}

export function areStructuredValuesEqual(left, right) {
  if (Object.is(left, right)) {
    return true;
  }

  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime();
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (!areStructuredValuesEqual(left[index], right[index])) {
        return false;
      }
    }

    return true;
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);

    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    for (const key of leftKeys) {
      if (!Object.prototype.hasOwnProperty.call(right, key)) {
        return false;
      }

      if (!areStructuredValuesEqual(left[key], right[key])) {
        return false;
      }
    }

    return true;
  }

  return false;
}

const definedKeys = (value) => Object.keys(value).filter((key) => value[key] !== undefined);

/**
 * JSON data (BuildingPlan snapshots, records) compared by content: equal when `JSON.stringify`
 * would write the same value, except that the order of an object's keys does not matter. As in
 * JSON, a property whose value is `undefined` is absent. Objects built by different code paths
 * list their keys in different orders; that is no change of data.
 *
 * @param {*} left
 * @param {*} right
 * @returns {boolean}
 */
export function areJsonValuesEqual(left, right) {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (!areJsonValuesEqual(left[index], right[index])) {
        return false;
      }
    }

    return true;
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = definedKeys(left);
    const rightKeys = definedKeys(right);

    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    for (const key of leftKeys) {
      if (
        !Object.prototype.hasOwnProperty.call(right, key) ||
        !areJsonValuesEqual(left[key], right[key])
      ) {
        return false;
      }
    }

    return true;
  }

  return JSON.stringify(left) === JSON.stringify(right);
}
