import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ThreadList, type ThreadListItem } from './thread-list';

afterEach(cleanup);

it('renders actions as siblings using original items and retains keyed row metadata', () => {
  const a = { id: 'a', title: 'Alpha', pinned: true, updatedAt: 0 };
  const b = { id: 'b', title: 'Beta' };
  const select = vi.fn();
  const action = vi.fn();
  const renderer = vi.fn((thread: ThreadListItem) => (
    <button onClick={action}>Copy {thread.id}</button>
  ));
  const view = render(
    <ThreadList
      threads={[a, b]}
      onSelect={select}
      now={60000}
      activeThreadId="a"
      renderActions={renderer}
    />
  );
  expect(renderer.mock.calls.map(([item]) => item)).toEqual([a, b]);
  expect(renderer.mock.calls[0][0]).toBe(a);
  const alpha = view.getByRole('button', { name: 'Alpha' });
  const copy = view.getByRole('button', { name: 'Copy a' });
  expect(alpha.contains(copy)).toBe(false);
  expect(copy.parentElement?.parentElement).toBe(alpha.parentElement);
  fireEvent.click(copy);
  expect(action).toHaveBeenCalledOnce();
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(alpha);
  expect(select.mock.calls).toEqual([['a']]);
  expect(alpha.getAttribute('aria-current')).toBe('true');
  expect(alpha.getAttribute('aria-label')).toBe('Alpha');
  expect(alpha.getAttribute('title')).toBe('Alpha');
  const descriptions = (alpha.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent);
  expect(descriptions).toEqual(['Pinned conversation', '1 min ago']);
  expect(within(alpha).getByText('1 min ago')).toBeTruthy();
  expect(alpha.querySelector('.tp-thread-list__pin')).toBeTruthy();
  view.rerender(
    <ThreadList
      threads={[b, a]}
      onSelect={select}
      now={60000}
      renderActions={renderer}
    />
  );
  expect(view.getByRole('button', { name: 'Alpha' })).toBe(alpha);
  expect(
    view
      .getAllByRole('listitem')
      .map((row) => row.querySelector('button')?.title)
  ).toEqual(['Beta', 'Alpha']);
});

it('omits empty action wrappers but honors zero and empty string ReactNodes', () => {
  const props = { threads: [{ id: 'a' }], onSelect: vi.fn() };
  const view = render(<ThreadList {...props} />);
  expect(view.container.querySelector('.tp-thread-list__actions')).toBeNull();
  for (const result of [null, false, undefined]) {
    view.rerender(<ThreadList {...props} renderActions={() => result} />);
    expect(view.container.querySelector('.tp-thread-list__actions')).toBeNull();
  }
  for (const result of [0, '']) {
    view.rerender(<ThreadList {...props} renderActions={() => result} />);
    expect(
      view.container.querySelector('.tp-thread-list__actions')?.textContent
    ).toBe(String(result));
  }
});
