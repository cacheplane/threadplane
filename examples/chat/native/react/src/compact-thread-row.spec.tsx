import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CompactThreadRow } from './compact-thread-row';
import type { ThreadListItem } from '@threadplane/react/chat';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('owns literal naming, exact selection, strict pin status and stable timestamp/focus', () => {
  vi.spyOn(Date, 'now').mockReturnValue(120000);
  const onSelect = vi.fn();
  const thread = Object.freeze({
    id: 'opaque/<&',
    title: 'Alpha <&',
    pinned: true,
    updatedAt: 0,
  });
  const view = render(
    <CompactThreadRow thread={thread} active onSelect={onSelect} />
  );
  const button = view.getByRole('button', {
    name: 'Alpha <&',
    description: 'Pinned conversation 2 min ago',
  });
  expect(button.getAttribute('title')).toBe('Alpha <&');
  expect(button.getAttribute('aria-current')).toBe('true');
  expect(button.querySelector('time')?.dateTime).toBe(
    '1970-01-01T00:00:00.000Z'
  );
  expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  expect(button.querySelector('svg')?.getAttribute('focusable')).toBe('false');
  expect(onSelect).not.toHaveBeenCalled();
  button.focus();
  fireEvent.click(button);
  expect(onSelect.mock.calls).toEqual([['opaque/<&']]);
  view.rerender(
    <CompactThreadRow
      thread={{ ...thread, title: '', pinned: false, updatedAt: -86400000 }}
      active={false}
      onSelect={onSelect}
    />
  );
  expect(
    view.getByRole('button', { name: 'opaque/<&', description: '1 day ago' })
  ).toBe(button);
  expect(button.hasAttribute('aria-current')).toBe(false);
  expect(button.querySelector('svg')).toBeNull();
  expect(document.activeElement).toBe(button);
});
it.each([undefined, NaN, Infinity, 8640000000000001, '2026-01-01'])(
  'omits invalid timestamp %s while retaining pin status',
  (updatedAt) => {
    const view = render(
      <CompactThreadRow
        thread={{ id: 'a', pinned: true, updatedAt } as ThreadListItem}
        active={false}
        onSelect={() => undefined}
      />
    );
    const button = view.getByRole('button', {
      name: 'a',
      description: 'Pinned conversation',
    });
    expect(button.querySelector('time')).toBeNull();
  }
);
