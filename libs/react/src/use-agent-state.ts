'use client';

import { useCallback, useRef, useSyncExternalStore } from 'react';

/** A session whose snapshot holds application state. */
interface StateSession<TState> {
  getSnapshot(): { readonly state?: TState };
  subscribe(notify: () => void): () => void;
}

/**
 * Observe the application state of an app-owned session. The component renders
 * again only when the state changes, not on every streamed token.
 *
 * The type comes from the session: a session created with a `stateType` yields
 * that type, read-only, and any other yields plain data. The value is
 * `undefined` until the session holds a state.
 *
 * Pass `select` to read one part of the state. The component then renders again
 * only when the selected value changes. `select` runs once per state, so it may
 * build a new value without causing another render.
 */
export function useAgentState<TState>(
  session: StateSession<TState>
): TState | undefined;
export function useAgentState<TState, TSelected>(
  session: StateSession<TState>,
  select: (state: TState | undefined) => TSelected
): TSelected;
export function useAgentState<TState, TSelected>(
  session: StateSession<TState>,
  select?: (state: TState | undefined) => TSelected
): TState | TSelected | undefined {
  const last = useRef<{
    readonly session: StateSession<TState>;
    readonly select: typeof select;
    readonly state: TState | undefined;
    readonly selected: TState | TSelected | undefined;
  }>(undefined);
  const getSnapshot = useCallback(() => {
    const state = session.getSnapshot().state;
    const seen = last.current;
    if (
      seen &&
      seen.session === session &&
      seen.select === select &&
      Object.is(seen.state, state)
    )
      return seen.selected;
    const selected = select ? select(state) : state;
    last.current = { session, select, state, selected };
    return selected;
  }, [session, select]);
  const subscribe = useCallback(
    (notify: () => void) => session.subscribe(notify),
    [session]
  );
  return useSyncExternalStore(subscribe, getSnapshot);
}
