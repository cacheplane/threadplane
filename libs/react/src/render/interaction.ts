import { resolveElementProps } from '@json-render/core';
import type {
  ActionBinding,
  ActionOnError,
  ActionOnSuccess,
  PropResolutionContext,
} from '@json-render/core';
import type {
  ReactRenderHandlers,
  RenderActionHandler,
  RenderEvent,
  RenderStore,
  RenderValue,
} from './types.js';
import { ownRenderValue } from './values.js';

type Params = Readonly<Record<string, RenderValue>>;
const NO_PARAMS: Params = Object.freeze(Object.create(null));

/** What every element of one mounted tree shares: the latest handlers, store and listener. */
export interface Interaction {
  readonly handler: (action: string) => RenderActionHandler | undefined;
  readonly store: () => RenderStore | undefined;
  readonly report: (event: RenderEvent) => void;
  /** False once the tree unmounts: late async follow-ups and events are dropped. */
  readonly alive: () => boolean;
}

/** Rejects a handler map that is not a plain record of functions. */
export function checkRenderHandlers(
  input: ReactRenderHandlers | undefined
): void {
  if (input === undefined) return;
  if (
    input === null ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(input))
  )
    throw new TypeError('Render handler maps must be plain records.');
  if (Object.getOwnPropertySymbols(input).length)
    throw new TypeError('Render handler maps cannot contain symbol keys.');
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(input)
  )) {
    if (!('value' in descriptor) || typeof descriptor.value !== 'function')
      throw new TypeError('Render handler maps must contain only functions.');
  }
}

/** The element's own copy of its `on` bindings for one event, or none. */
function bindingsFor(on: unknown, event: string): readonly ActionBinding[] {
  if (on === undefined || on === null) return [];
  const owned = ownRenderValue(on, true) as Readonly<Record<string, unknown>>;
  if (!Object.hasOwn(owned, event)) return [];
  const value = owned[event];
  const list = Array.isArray(value) ? value : [value];
  return list.filter(
    (binding): binding is ActionBinding =>
      binding !== null &&
      typeof binding === 'object' &&
      typeof (binding as { action?: unknown }).action === 'string'
  );
}

function confirmed(message: string): boolean {
  const view = globalThis.window;
  if (typeof view?.confirm !== 'function') return true;
  return Boolean(view.confirm(message));
}

/** Follows a spec's `navigate` only to an http(s) or relative address. */
function navigate(target: string): void {
  const location = globalThis.location;
  if (!location) return;
  let url: URL;
  try {
    url = new URL(target, location.href);
  } catch {
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  location.assign(url.href);
}

/** Writes a follow-up's `set` map; after a failure, `'$error.message'` becomes the error's message. */
function write(
  interaction: Interaction,
  entries: Record<string, unknown>,
  failure?: { readonly error: unknown }
) {
  const store = interaction.store();
  if (!store) return;
  for (const [path, value] of Object.entries(entries)) {
    store.set(
      path,
      failure && value === '$error.message'
        ? failure.error instanceof Error
          ? failure.error.message
          : String(failure.error)
        : ownRenderValue(value)
    );
  }
}

function succeed(
  interaction: Interaction,
  onSuccess: ActionOnSuccess | undefined
) {
  if (!onSuccess || !interaction.alive()) return;
  if ('navigate' in onSuccess) return navigate(onSuccess.navigate);
  if ('set' in onSuccess) return write(interaction, onSuccess.set);
  runNamed(interaction, onSuccess.action);
}

function fail(
  interaction: Interaction,
  onError: ActionOnError,
  error: unknown
) {
  if (!interaction.alive()) return;
  if ('set' in onError) return write(interaction, onError.set, { error });
  runNamed(interaction, onError.action);
}

/** The follow-up form: an action by name, with no params and no follow-ups of its own. */
function runNamed(interaction: Interaction, action: string) {
  const handler = interaction.handler(action);
  if (handler) run(interaction, action, handler, NO_PARAMS);
}

function run(
  interaction: Interaction,
  action: string,
  handler: RenderActionHandler,
  params: Params,
  onSuccess?: ActionOnSuccess,
  onError?: ActionOnError
) {
  let result: unknown;
  try {
    result = handler(params);
  } catch (error) {
    if (!onError) throw error;
    fail(interaction, onError, error);
    return;
  }
  if (
    result !== null &&
    (typeof result === 'object' || typeof result === 'function') &&
    typeof (result as PromiseLike<unknown>).then === 'function'
  ) {
    Promise.resolve(result as PromiseLike<unknown>).then(
      (value) => {
        if (!interaction.alive()) return;
        interaction.report({ type: 'handler', action, params, result: value });
        succeed(interaction, onSuccess);
      },
      (error: unknown) => {
        if (!interaction.alive()) return;
        interaction.report({
          type: 'handler',
          action,
          params,
          result: undefined,
        });
        if (onError) fail(interaction, onError, error);
      }
    );
    return;
  }
  interaction.report({ type: 'handler', action, params, result });
  succeed(interaction, onSuccess);
}

/**
 * Runs an element's bindings for one event, in order. Params resolve against the element's own
 * context (its repeat row included); the view's payload wins on key collisions.
 */
export function dispatchElementEvent(
  interaction: Interaction,
  on: unknown,
  event: string,
  context: PropResolutionContext,
  payload: Readonly<Record<string, RenderValue>> | undefined
): void {
  if (!interaction.alive()) return;
  const supplied =
    payload === undefined
      ? NO_PARAMS
      : (ownRenderValue(payload) as Readonly<Record<string, RenderValue>>);
  if (
    supplied === null ||
    typeof supplied !== 'object' ||
    Array.isArray(supplied)
  )
    throw new TypeError('A render event payload must be a plain record.');
  for (const binding of bindingsFor(on, event)) {
    if (binding.confirm && !confirmed(binding.confirm.message)) continue;
    const handler = interaction.handler(binding.action);
    if (!handler) continue;
    const resolved = resolveElementProps(
      (binding.params ?? {}) as Record<string, unknown>,
      context
    );
    const params = ownRenderValue({ ...resolved, ...supplied }) as Params;
    run(
      interaction,
      binding.action,
      handler,
      params,
      binding.onSuccess,
      binding.onError
    );
  }
}
