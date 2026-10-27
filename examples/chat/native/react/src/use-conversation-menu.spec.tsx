import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
} from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useConversationMenu } from './use-conversation-menu';

afterEach(cleanup);

it('claims original row events synchronously and ordinary opening resets the context origin', () => {
  const state = renderHook(() => useConversationMenu([{ id: 'a' }]));
  const view = render(
    <button
      onContextMenu={(event) => state.result.current.onContextMenu('a', event)}
    >
      Row
    </button>
  );
  const row = view.getByRole('button');
  const pointer = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 53,
    clientY: 67,
  });
  fireEvent(row, pointer);
  expect(pointer.defaultPrevented).toBe(true);
  const context = state.result.current.forThread('a');
  expect(context.open).toBe(true);
  expect(context.anchorPoint).toEqual({ x: 53, y: 67 });
  expect(context.returnFocusTo).toBe(row);
  act(() => context.onOpenChange(true));
  expect(state.result.current.forThread('a').anchorPoint).toBeNull();
  expect(state.result.current.forThread('a').returnFocusTo).toBeNull();
});

it('ignores stale A close callbacks after B and after a new A generation', () => {
  const state = renderHook(() =>
    useConversationMenu([{ id: 'a' }, { id: 'b' }])
  );
  act(() => state.result.current.forThread('a').onOpenChange(true));
  const oldA = state.result.current.forThread('a');
  act(() => state.result.current.forThread('b').onOpenChange(true));
  act(() => oldA.onOpenChange(false));
  expect(state.result.current.forThread('b').open).toBe(true);
  act(() => state.result.current.forThread('a').onOpenChange(true));
  act(() => oldA.onOpenChange(false));
  expect(state.result.current.forThread('a').open).toBe(true);
  act(() => state.result.current.forThread('a').onOpenChange(false));
  expect(state.result.current.forThread('a').open).toBe(false);
});

it('expires a request when its row disappears so returning the same ID stays closed', () => {
  const state = renderHook(({ rows }) => useConversationMenu(rows), {
    initialProps: { rows: [{ id: 'a' }] },
  });
  act(() => state.result.current.forThread('a').onOpenChange(true));
  expect(state.result.current.forThread('a').open).toBe(true);
  state.rerender({ rows: [] });
  expect(state.result.current.forThread('a').open).toBe(false);
  state.rerender({ rows: [{ id: 'a' }] });
  expect(state.result.current.forThread('a').open).toBe(false);
});

it('keys request occurrences by partition while retaining same-partition metadata updates', () => {
  const state = renderHook(({ rows }) => useConversationMenu(rows), {
    initialProps: {
      rows: [{ id: 'a', occurrenceKey: 'active', title: 'Old', pinned: false }],
    },
  });
  act(() => state.result.current.forThread('a').onOpenChange(true));
  const old = state.result.current.forThread('a');
  state.rerender({
    rows: [{ id: 'a', occurrenceKey: 'active', title: 'New', pinned: true }],
  });
  expect(state.result.current.forThread('a').open).toBe(true);
  state.rerender({
    rows: [{ id: 'a', occurrenceKey: 'archived', title: 'New', pinned: true }],
  });
  expect(state.result.current.forThread('a').open).toBe(false);
  state.rerender({
    rows: [{ id: 'a', occurrenceKey: 'active', title: 'New', pinned: true }],
  });
  expect(state.result.current.forThread('a').open).toBe(false);
  act(() => state.result.current.forThread('a').onOpenChange(true));
  act(() => old.onOpenChange(false));
  expect(state.result.current.forThread('a').open).toBe(true);
});
