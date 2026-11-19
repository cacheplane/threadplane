import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAgentState } from './index';

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
afterEach(cleanup);

describe('useAgentState', () => {
  it('returns the state, and undefined while the session holds none', () => {
    const session = store({ status: 'idle' });
    const view = renderHook(() => useAgentState(session), {
      reactStrictMode: true,
    });
    expect(view.result.current).toBeUndefined();
    const state = { todos: ['a'], owner: 'me' };
    act(() => session.publish({ status: 'idle', state }));
    expect(view.result.current).toBe(state);
  });

  it('renders again when the state changes, not when the rest of the snapshot does', () => {
    const state = { todos: ['a'], owner: 'me' };
    const session = store({ status: 'idle', state });
    const renders = vi.fn();
    function Owner() {
      renders();
      return <p>{useAgentState(session)?.owner}</p>;
    }
    const view = render(<Owner />);
    expect(renders).toHaveBeenCalledTimes(1);
    act(() => session.publish({ status: 'running', state }));
    act(() => session.publish({ status: 'idle', state }));
    expect(renders).toHaveBeenCalledTimes(1);
    act(() =>
      session.publish({ status: 'idle', state: { ...state, owner: 'you' } })
    );
    expect(renders).toHaveBeenCalledTimes(2);
    expect(view.container.textContent).toBe('you');
  });

  it('runs an inline selector once per state and renders only when its value changes', () => {
    const first = { todos: ['a'], owner: 'me' };
    const session = store({ status: 'idle', state: first });
    const select = vi.fn((state: Board | undefined) => ({
      count: state?.todos.length ?? 0,
    }));
    const renders = vi.fn();
    function Count() {
      renders();
      // A new function and a new object each time, as an app would write it.
      return <p>{useAgentState(session, (state) => select(state)).count}</p>;
    }
    const view = render(<Count />);
    expect(view.container.textContent).toBe('1');
    const settled = renders.mock.calls.length;
    const selected = select.mock.calls.length;
    act(() => session.publish({ status: 'running', state: first }));
    expect(renders).toHaveBeenCalledTimes(settled);
    expect(select).toHaveBeenCalledTimes(selected);
    act(() =>
      session.publish({ status: 'idle', state: { ...first, todos: ['a', 'b'] } })
    );
    expect(view.container.textContent).toBe('2');
  });

  it('does not render again when a stable selector picks an unchanged value', () => {
    const todos = ['a'];
    const session = store({ status: 'idle', state: { todos, owner: 'me' } });
    const pick = (state: Board | undefined) => state?.todos;
    const renders = vi.fn();
    function Todos() {
      renders();
      return <p>{useAgentState(session, pick)?.join()}</p>;
    }
    render(<Todos />);
    act(() => session.publish({ status: 'idle', state: { todos, owner: 'you' } }));
    expect(renders).toHaveBeenCalledTimes(1);
  });

  it('follows a replaced session and releases its subscription on unmount', () => {
    const a = store({ status: 'idle', state: { todos: [], owner: 'a' } });
    const b = store({ status: 'idle', state: { todos: [], owner: 'b' } });
    const view = renderHook(
      ({ session }) => useAgentState(session, (state) => state?.owner),
      { initialProps: { session: a } }
    );
    expect(view.result.current).toBe('a');
    view.rerender({ session: b });
    expect(view.result.current).toBe('b');
    expect(a.listeners.size).toBe(0);
    expect(b.listeners.size).toBe(1);
    view.unmount();
    expect(b.listeners.size).toBe(0);
  });
});
