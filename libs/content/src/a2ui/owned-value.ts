import type { A2uiValue } from './types.js';

/** Arrays support actual indices only, never host properties such as length. */
export function assertArrayIndex(key: string): void {
  const index = Number(key);
  if (!Number.isInteger(index) || index < 0 || index >= 4294967295 || String(index) !== key)
    throw new TypeError(`Unsupported A2UI array property: ${key}`);
}

/** Capture own descriptors without invoking accessors. Hostile proxies are outside
 * this plain-data boundary. Ancestors, rather than all seen objects, detect cycles
 * while permitting shared acyclic input branches. */
export function captureValue(input: unknown): A2uiValue {
  const ancestors = new Set<object>();
  function capture(value: unknown): A2uiValue {
    if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean')
      return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || value === null)
      throw new TypeError('A2UI values must be finite plain data');
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
      throw new TypeError('A2UI values must be plain records or arrays');
    if (ancestors.has(value)) throw new TypeError('Cyclic A2UI value');
    if (Object.getOwnPropertySymbols(value).length) throw new TypeError('Symbol A2UI keys are unsupported');
    ancestors.add(value);
    try {
      const result = array ? new Array(value.length) : Object.create(prototype);
      for (const key of Object.getOwnPropertyNames(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!('value' in descriptor)) throw new TypeError('A2UI accessors are unsupported');
        if (array) {
          if (key === 'length') continue;
          assertArrayIndex(key);
        }
        Object.defineProperty(result, key, {
          value: capture(descriptor.value), enumerable: descriptor.enumerable,
          writable: false, configurable: false,
        });
      }
      return Object.freeze(result) as A2uiValue;
    } finally {
      ancestors.delete(value);
    }
  }
  return capture(input);
}
