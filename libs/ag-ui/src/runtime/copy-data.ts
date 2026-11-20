/** Copies portable data by occurrence, with linear cost in the traversed graph.
 * Admission does not trust frozen external parents or retain identity caches. */
export function copyData(
  value: unknown,
  freeze: boolean,
  ancestors = new Set<object>()
): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return value;
  if (typeof value !== 'object')
    throw new TypeError('Portable data must be plain data');
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    array
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null
  ) {
    throw new TypeError('Portable data must use plain objects or arrays');
  }
  if (ancestors.has(value))
    throw new TypeError('Portable data must be acyclic');
  ancestors.add(value);
  try {
    const copy = array ? new Array(value.length) : Object.create(prototype);
    for (const key of Object.keys(value)) {
      // Define data properties directly: __proto__ and constructor are payload.
      Object.defineProperty(copy, key, {
        value: copyData(
          (value as Record<string, unknown>)[key],
          freeze,
          ancestors
        ),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return freeze ? Object.freeze(copy) : copy;
  } finally {
    ancestors.delete(value);
  }
}
