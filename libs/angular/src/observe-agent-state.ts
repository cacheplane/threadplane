import { computed, type Signal } from '@angular/core';
import { observeAgent } from './observe-agent';

/** A session whose snapshot holds application state. */
interface StateSession<TState> {
  getSnapshot(): { readonly state?: TState };
  subscribe(notify: () => void): () => void;
}

/**
 * Observe the application state of an app-owned session in an injection
 * context. The signal changes only when the state changes, not on every
 * streamed token.
 *
 * The type comes from the session: a session created with a `stateType` yields
 * that type, read-only, and any other yields plain data. The value is
 * `undefined` until the session holds a state.
 *
 * Pass `select` to read one part of the state. `select` runs once per state,
 * and the signal changes only when the selected value does.
 */
export function observeAgentState<TState>(
  session: StateSession<TState>
): Signal<TState | undefined>;
export function observeAgentState<TState, TSelected>(
  session: StateSession<TState>,
  select: (state: TState | undefined) => TSelected
): Signal<TSelected>;
export function observeAgentState<TState, TSelected>(
  session: StateSession<TState>,
  select?: (state: TState | undefined) => TSelected
): Signal<TState | TSelected | undefined> {
  const snapshot = observeAgent(session);
  const state = computed(() => snapshot().state);
  return select ? computed(() => select(state())) : state;
}
