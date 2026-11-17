import { act, cleanup, createEvent, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThreadList, type ThreadActionAdapter, type ThreadListItem } from './index';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const threads: readonly ThreadListItem[] = [
  { id: 'a', title: 'Alpha', pinned: true },
  { id: 'b', title: 'Beta', pinned: true },
  { id: 'c', title: 'Gamma', pinned: true },
  { id: 'd', title: 'Delta' },
];
const list = (actions?: ThreadActionAdapter) =>
  render(<ThreadList threads={threads} onSelect={() => undefined} actions={actions} />);
const row = (view: ReturnType<typeof render>, id: string) =>
  view.container.querySelector<HTMLElement>(`[data-row-id="${id}"]`)!;
const order = (view: ReturnType<typeof render>) =>
  Array.from(view.container.querySelectorAll<HTMLElement>('[data-row-id]')).map(
    (item) => item.dataset['rowId']
  );
const transfer = () => {
  const data = new Map<string, string>();
  return {
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    effectAllowed: 'none',
    dropEffect: 'none',
  };
};
/** Rows are 40px tall; a pointer at `y` within the row picks its half. */
const over = (target: HTMLElement, y: number, dataTransfer: ReturnType<typeof transfer>) => {
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
    top: 0, left: 0, right: 200, bottom: 40, width: 200, height: 40, x: 0, y: 0, toJSON: () => ({}),
  });
  const event = createEvent.dragOver(target, { dataTransfer });
  Object.defineProperty(event, 'clientY', { value: y });
  fireEvent(target, event);
  return event;
};

describe('ThreadList pinned drag reorder', () => {
  it('makes nothing draggable without a reorder command', () => {
    const view = list({ pin: vi.fn() });
    expect(view.container.querySelector('[draggable]')).toBeNull();
  });

  it('makes only pinned rows draggable', () => {
    const view = list({ reorderPinned: vi.fn() });
    expect(row(view, 'a').getAttribute('draggable')).toBe('true');
    expect(row(view, 'c').getAttribute('draggable')).toBe('true');
    expect(row(view, 'd').hasAttribute('draggable')).toBe(false);
  });

  it('marks the dragged row and shows where it would land', () => {
    const view = list({ reorderPinned: vi.fn() });
    const data = transfer();
    fireEvent.dragStart(row(view, 'a'), { dataTransfer: data });
    expect(data.getData('text/plain')).toBe('a');
    expect(data.effectAllowed).toBe('move');
    expect(row(view, 'a').hasAttribute('data-dragging')).toBe(true);
    const accepted = over(row(view, 'c'), 5, data);
    expect(accepted.defaultPrevented).toBe(true);
    expect(row(view, 'c').getAttribute('data-drop-position')).toBe('before');
    over(row(view, 'c'), 35, data);
    expect(row(view, 'c').getAttribute('data-drop-position')).toBe('after');
    fireEvent.dragLeave(row(view, 'c'));
    expect(row(view, 'c').hasAttribute('data-drop-position')).toBe(false);
  });

  it('drops before a row: reorders at once with that row as the anchor', async () => {
    const reorderPinned = vi.fn(async () => undefined);
    const view = list({ reorderPinned });
    const data = transfer();
    fireEvent.dragStart(row(view, 'c'), { dataTransfer: data });
    over(row(view, 'a'), 5, data);
    fireEvent.drop(row(view, 'a'), { dataTransfer: data });
    expect(reorderPinned.mock.calls).toEqual([['c', 'a']]);
    expect(order(view)).toEqual(['c', 'a', 'b', 'd']);
    expect(view.container.querySelector('[data-dragging], [data-drop-position]')).toBeNull();
    await act(async () => undefined);
  });

  it('drops after a row: anchors on the next pinned row, or last', async () => {
    const reorderPinned = vi.fn(async () => undefined);
    const view = list({ reorderPinned });
    const data = transfer();
    fireEvent.dragStart(row(view, 'a'), { dataTransfer: data });
    over(row(view, 'b'), 35, data);
    fireEvent.drop(row(view, 'b'), { dataTransfer: data });
    expect(reorderPinned.mock.calls[0]).toEqual(['a', 'c']);
    await act(async () => undefined);
    fireEvent.dragStart(row(view, 'b'), { dataTransfer: data });
    over(row(view, 'c'), 35, data);
    fireEvent.drop(row(view, 'c'), { dataTransfer: data });
    expect(reorderPinned.mock.calls[1]).toEqual(['b', null]);
    await act(async () => undefined);
  });

  it('refuses a drop on itself, on an unpinned row, and from outside the list', () => {
    const reorderPinned = vi.fn(async () => undefined);
    const view = list({ reorderPinned });
    const data = transfer();
    // Nothing from this list is being dragged.
    expect(over(row(view, 'a'), 5, data).defaultPrevented).toBe(false);
    fireEvent.drop(row(view, 'a'), { dataTransfer: data });
    fireEvent.dragStart(row(view, 'a'), { dataTransfer: data });
    expect(over(row(view, 'a'), 5, data).defaultPrevented).toBe(false);
    expect(over(row(view, 'd'), 5, data).defaultPrevented).toBe(false);
    fireEvent.drop(row(view, 'd'), { dataTransfer: data });
    expect(reorderPinned).not.toHaveBeenCalled();
  });

  it('clears the drag state when the drag ends without a drop', () => {
    const view = list({ reorderPinned: vi.fn() });
    const data = transfer();
    fireEvent.dragStart(row(view, 'a'), { dataTransfer: data });
    over(row(view, 'b'), 5, data);
    fireEvent.dragEnd(row(view, 'a'));
    expect(view.container.querySelector('[data-dragging], [data-drop-position]')).toBeNull();
  });

  it('puts the rows back when the command rejects', async () => {
    const reorderPinned = vi.fn(async () => {
      throw new Error('no');
    });
    const view = list({ reorderPinned });
    const data = transfer();
    fireEvent.dragStart(row(view, 'c'), { dataTransfer: data });
    over(row(view, 'a'), 5, data);
    fireEvent.drop(row(view, 'a'), { dataTransfer: data });
    expect(order(view)).toEqual(['c', 'a', 'b', 'd']);
    await act(async () => undefined);
    await act(async () => undefined);
    expect(order(view)).toEqual(['a', 'b', 'c', 'd']);
  });
});
