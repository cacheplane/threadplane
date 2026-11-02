import { getByPointer } from './pointer.js';
import { isFunctionCall, isPathRef } from './guards.js';
import {
  withActiveRegistry, warnUnknownA2uiFunction,
  type A2uiFunctionRegistry,
} from './functions.js';

/** Repeated-item context whose base path anchors relative data-model bindings. */
export interface A2uiScope {
  basePath: string;
  item: unknown;
}

function resolvePathRef(
  ref: { path: string },
  model: Record<string, unknown>,
  scope?: A2uiScope,
): unknown {
  const path = ref.path;
  if (path.startsWith('/')) return getByPointer(model, path);
  if (scope) return getByPointer(model, `${scope.basePath}/${path}`);
  return getByPointer(model, '/' + path);
}

/**
 * Resolves an A2UI v0.9 dynamic value against a client data model.
 *
 * Bare literals (strings, numbers, booleans) pass through unchanged, `{ path }`
 * references read from the model by JSON-pointer path, arrays resolve
 * element-wise, and client-side function calls (`{ call }`) execute through the
 * provided function registry — argument values resolve recursively, so args may
 * themselves be bindings or nested calls. Without a registry (or for unknown
 * function names) calls resolve to `undefined`. Unrecognized plain objects pass
 * through unchanged.
 *
 * @example
 * ```ts
 * const model = { customer: { name: 'Ada' } };
 * resolveDynamic({ path: '/customer/name' }, model); // 'Ada'
 * resolveDynamic('Checkout', model); // 'Checkout'
 * resolveDynamic(
 *   { call: 'formatString', args: { value: 'Hi ${/customer/name}' } },
 *   model, undefined, createA2uiFunctionRegistry(),
 * ); // 'Hi Ada'
 * ```
 */
export function resolveDynamic(
  value: unknown,
  model: Record<string, unknown>,
  scope?: A2uiScope,
  registry?: A2uiFunctionRegistry,
): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(item => resolveDynamic(item, model, scope, registry));

  // Client-side function call. Checked before path refs so
  // `{ call, args: { path: ... } }`-style args never masquerade as bindings.
  if (isFunctionCall(value)) {
    if (!registry) return undefined;
    const impl = registry.get(value.call);
    if (!impl) {
      warnUnknownA2uiFunction(value.call);
      return undefined;
    }
    const args = (value.args ?? {}) as Record<string, unknown>;
    return withActiveRegistry(registry, () =>
      impl(args, {
        resolveArg: (v) => resolveDynamic(v, model, scope, registry),
      }),
    );
  }

  // Path reference
  if (isPathRef(value)) return resolvePathRef(value, model, scope);

  // Bare literal passthrough (string, number, boolean, plain object)
  return value;
}
