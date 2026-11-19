import {
  createEnvironmentInjector,
  effect,
  EnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeAgentState } from './public-api';

interface Board {
  readonly todos: readonly string[];
  readonly owner: string;
}
type Snapshot = { readonly status: string; readonly state?: Board };
/** A session whose snapshot the test replaces by hand. */
function store(first: Snapshot) {
  let snapshot = first;
  const listeners = new Set<() => void>();
  return {
    listeners,
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => void listeners.delete(notify);
    },
    publish(next: Snapshot) {
      snapshot = next;
      for (const notify of [...listeners]) notify();
    },
  };
}
const injectors: EnvironmentInjector[] = [];
function scope() {
  const injector = createEnvironmentInjector(
    [],
    TestBed.inject(EnvironmentInjector)
  );
  injectors.push(injector);
  return injector;
}
afterEach(() => {
  for (const injector of injectors.splice(0)) injector.destroy();
});

describe('observeAgentState', () => {
  it('holds the state, and undefined while the session holds none', () => {
    const session = store({ status: 'idle' });
    const state = runInInjectionContext(scope(), () =>
      observeAgentState(session)
    );
    expect(state()).toBeUndefined();
    const board = { todos: ['a'], owner: 'me' };
    session.publish({ status: 'idle', state: board });
    expect(state()).toBe(board);
  });

  it('notifies dependents when the state changes, not when the rest of the snapshot does', () => {
    const board = { todos: ['a'], owner: 'me' };
    const session = store({ status: 'idle', state: board });
    const injector = scope();
    const seen = vi.fn();
    runInInjectionContext(injector, () => {
      const state = observeAgentState(session);
      effect(() => seen(state()?.owner));
    });
    TestBed.tick();
    expect(seen).toHaveBeenCalledTimes(1);
    session.publish({ status: 'running', state: board });
    TestBed.tick();
    expect(seen).toHaveBeenCalledTimes(1);
    session.publish({ status: 'idle', state: { ...board, owner: 'you' } });
    TestBed.tick();
    expect(seen.mock.calls).toEqual([['me'], ['you']]);
  });

  it('runs the selector once per state and keeps its value while the state is unchanged', () => {
    const board = { todos: ['a'], owner: 'me' };
    const session = store({ status: 'idle', state: board });
    const select = vi.fn((state: Board | undefined) => ({
      count: state?.todos.length ?? 0,
    }));
    const count = runInInjectionContext(scope(), () =>
      observeAgentState(session, select)
    );
    const first = count();
    expect(first).toEqual({ count: 1 });
    session.publish({ status: 'running', state: board });
    expect(count()).toBe(first);
    expect(select).toHaveBeenCalledTimes(1);
    session.publish({ status: 'idle', state: { ...board, todos: ['a', 'b'] } });
    expect(count()).toEqual({ count: 2 });
    expect(select).toHaveBeenCalledTimes(2);
  });

  it('releases its subscription when the context is destroyed', () => {
    const session = store({ status: 'idle' });
    const injector = scope();
    runInInjectionContext(injector, () => observeAgentState(session));
    expect(session.listeners.size).toBe(1);
    injectors.splice(injectors.indexOf(injector), 1);
    injector.destroy();
    expect(session.listeners.size).toBe(0);
    expect(() => observeAgentState(session)).toThrow();
  });
});
