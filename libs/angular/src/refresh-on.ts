import { effect, untracked, type Signal } from '@angular/core';

/** What a run-end helper calls: a function, or anything with `refresh()`. */
type Refresh =
  | (() => void | Promise<void>)
  | { refresh(): void | Promise<void> };

function run(target: Refresh): void {
  const result =
    typeof target === 'function' ? target() : target.refresh.call(target);
  // A failed refresh shows where it is published; it never escapes as an
  // unhandled rejection.
  if (result && typeof result.then === 'function')
    result.then(undefined, () => undefined);
}

/**
 * Calls `fn` each time the agent's status leaves `'running'`: when a run
 * completes, fails or pauses on an interrupt. Pass a thread directory view in
 * place of a function to refresh it. It keeps following the agent across
 * thread switches.
 *
 * Call it in an injection context; it uses an `effect`, so the call is
 * delivered when effects flush and the registration ends with the context.
 *
 * @example
 * ```ts
 * constructor() {
 *   refreshOnRunEnd(this.agent, this.threads);
 * }
 * ```
 */
export function refreshOnRunEnd(
  agent: { readonly status: Signal<string> },
  fn: Refresh
): void {
  refreshOnTransition(agent.status, (status) => status === 'running', fn);
}

/**
 * Calls `fn` each time the watched signal goes from an active value to an
 * inactive one, as `isActive` judges them. The general form of
 * {@link refreshOnRunEnd}, for a state machine of the app's own.
 *
 * Call it in an injection context.
 */
export function refreshOnTransition<T>(
  watch: Signal<T>,
  isActive: (value: T) => boolean,
  fn: Refresh
): void {
  let lastActive = isActive(watch());
  effect(() => {
    const active = isActive(watch());
    const ended = lastActive && !active;
    lastActive = active;
    // Untracked: what `fn` reads is not what this effect watches.
    if (ended) untracked(() => run(fn));
  });
}
