import { resolveElementProps } from '@json-render/core';
import type { PropResolutionContext } from '@json-render/core';
import type { ReactRenderHandlers, RenderValue } from './types.js';
import { ownRenderValue } from './values.js';

/** What one mounted `RenderSpec` lends its elements for running actions. */
export interface RenderActionHost {
  readonly handlers?: ReactRenderHandlers;
  readonly onStateChange?: (path: string, value: RenderValue) => void;
  /** False once the tree unmounted; follow-ups of a settled promise then do nothing. */
  readonly mounted: () => boolean;
  /** Asks the person to confirm; absent where there is nobody to ask. */
  readonly confirm?: (message: string) => boolean;
}

type Data = Readonly<Record<string, unknown>>;

const record = (value: unknown): value is Data =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Runs a binding's follow-up. `set` writes each path through `onStateChange`;
 * in an error follow-up the literal `'$error.message'` becomes the error's
 * message. `action` calls that handler with no params. `navigate` is not
 * performed: a spec is agent-authored data and does not get to move the page.
 */
function follow(host: RenderActionHost, step: unknown, error?: unknown) {
  if (!record(step) || !host.mounted()) return;
  if (record(step['set'])) {
    const message = error instanceof Error ? error.message : String(error);
    for (const [path, value] of Object.entries(step['set']))
      host.onStateChange?.(
        path,
        ownRenderValue(
          error !== undefined && value === '$error.message' ? message : value
        )
      );
    return;
  }
  const action = step['action'];
  if (typeof action === 'string') {
    const handler =
      host.handlers && Object.hasOwn(host.handlers, action)
        ? host.handlers[action]
        : undefined;
    void handler?.(Object.freeze({}));
  }
}

/**
 * Runs the bindings an element declares for one event, in order. Each names a
 * handler from the app's `handlers`; a binding whose handler the app did not
 * supply is skipped. Params resolve against state and the element's repeat
 * scope like its props, and the view's payload wins on a shared key. A handler
 * that throws with no `onError` rethrows to the view that emitted.
 */
export function runActions(
  host: RenderActionHost,
  declared: unknown,
  context: PropResolutionContext,
  payload?: Readonly<Record<string, RenderValue>>
): void {
  if (!host.handlers || declared === undefined || declared === null) return;
  const bindings: unknown[] = Array.isArray(declared) ? declared : [declared];
  for (const binding of bindings) {
    if (!record(binding)) continue;
    const action = binding['action'];
    if (typeof action !== 'string') continue;
    const handler = Object.hasOwn(host.handlers, action)
      ? host.handlers[action]
      : undefined;
    if (!handler) continue;
    const confirm = binding['confirm'];
    const question = record(confirm) ? confirm['message'] : undefined;
    if (typeof question === 'string' && host.confirm && !host.confirm(question))
      continue;
    const params = ownRenderValue({
      ...(resolveElementProps(
        ownRenderValue(record(binding['params']) ? binding['params'] : {}, true) as Record<
          string,
          unknown
        >,
        context
      ) as Record<string, unknown>),
      ...payload,
    }) as Readonly<Record<string, RenderValue>>;
    let result: unknown;
    try {
      result = handler(params);
    } catch (error) {
      if (!record(binding['onError'])) throw error;
      follow(host, binding['onError'], error);
      continue;
    }
    if (result instanceof Promise)
      result.then(
        () => follow(host, binding['onSuccess']),
        (error: unknown) => follow(host, binding['onError'], error ?? 'Error')
      );
    else follow(host, binding['onSuccess']);
  }
}
