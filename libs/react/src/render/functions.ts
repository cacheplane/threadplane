import type { ComputedFunction } from '@json-render/core';
import type { ReactRenderFunctions, RenderValue } from './types.js';
import { ownRenderValue } from './values.js';

export function ownRenderFunctions(
  input: ReactRenderFunctions | undefined
): Record<string, ComputedFunction> | undefined {
  if (input === undefined) return undefined;
  if (
    input === null ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(input))
  )
    throw new TypeError('Render function maps must be plain records.');
  if (Object.getOwnPropertySymbols(input).length)
    throw new TypeError('Render function maps cannot contain symbol keys.');
  const owned = Object.create(null) as Record<string, ComputedFunction>;
  for (const [name, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(input)
  )) {
    if (!('value' in descriptor))
      throw new TypeError('Render functions must be data properties.');
    const callback = descriptor.value;
    if (typeof callback !== 'function')
      throw new TypeError('Render functions must contain only functions.');
    Object.defineProperty(owned, name, {
      enumerable: true,
      value: (args: Record<string, unknown>) =>
        callback(ownRenderValue(args) as Readonly<Record<string, RenderValue>>),
    });
  }
  return Object.freeze(owned);
}
