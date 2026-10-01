import type { RenderValue } from './types.js';

// Resolver outputs may contain undefined for a path that has not arrived yet.
// Own null-prototype records also prevent upstream path reads inheriting data.
export function ownRenderValue(value: unknown, raw = false): RenderValue {
  const ancestors = new Set<object>();
  function copy(input: unknown): RenderValue {
    if (input === undefined && !raw) return undefined;
    if (
      input === null ||
      typeof input === 'string' ||
      typeof input === 'boolean'
    )
      return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input !== 'object' || input === null)
      throw new TypeError('Render data must contain finite JSON values.');
    if (ancestors.has(input)) throw new TypeError('Cyclic render JSON data.');
    if (
      !Array.isArray(input) &&
      ![null, Object.prototype].includes(Object.getPrototypeOf(input))
    )
      throw new TypeError('Render data must contain plain JSON objects.');
    if (Object.getOwnPropertySymbols(input).length)
      throw new TypeError('Render JSON data cannot contain symbol keys.');
    ancestors.add(input);
    try {
      if (Array.isArray(input)) {
        if (Object.getPrototypeOf(input) !== Array.prototype)
          throw new TypeError(
            'Render JSON arrays must use the plain array prototype.'
          );
        const descriptors = Object.getOwnPropertyDescriptors(input);
        for (const [key, descriptor] of Object.entries(descriptors)) {
          if (!('value' in descriptor))
            throw new TypeError(
              'Render JSON properties must be data properties.'
            );
          if (key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key))
            throw new TypeError(
              'Render JSON arrays cannot contain custom properties.'
            );
        }
        return Object.freeze(
          Array.from({ length: input.length }, (_, index) =>
            copy(Object.getOwnPropertyDescriptor(input, String(index))?.value)
          )
        );
      }
      const entries = Object.entries(
        Object.getOwnPropertyDescriptors(input)
      ).filter(([, descriptor]) => descriptor.enumerable);
      const owned = Object.create(null) as Record<string, RenderValue>;
      for (const [key, descriptor] of entries) {
        if (!('value' in descriptor))
          throw new TypeError(
            'Render JSON properties must be data properties.'
          );
        if (raw && key === '__proto__')
          throw new TypeError(
            'Raw render props cannot contain __proto__ until the upstream resolver preserves that key.'
          );
        Object.defineProperty(owned, key, {
          value: copy(descriptor.value),
          enumerable: true,
        });
      }
      return Object.freeze(owned);
    } finally {
      ancestors.delete(input);
    }
  }
  return copy(value);
}
