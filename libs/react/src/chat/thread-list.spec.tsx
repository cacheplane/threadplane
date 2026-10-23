import { StrictMode } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThreadList, type ThreadListItem } from './index';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ThreadList', () => {
  it('renders supplied items with independent labels and retains keyed focus across renderer changes', () => {
    const rows = Object.freeze([
      Object.freeze({ id: 'a', title: 'Alpha', updatedAt: 0 }),
      Object.freeze({ id: 'b', title: '', updatedAt: 0 }),
    ]);
    const onSelect = vi.fn();
    const onNewThread = vi.fn();
    const renderTitle = vi.fn((item: ThreadListItem) => <mark>{item.id}</mark>);
    const props = {
      threads: rows,
      onSelect,
      onNewThread,
      activeThreadId: 'a',
      now: 60000,
    };
    const view = render(<ThreadList {...props} renderTitle={renderTitle} />);
    const alpha = view.getByRole('button', {
      name: 'Alpha',
      description: '1 min ago',
    });
    const row = alpha.parentElement;
    expect(renderTitle).toHaveBeenCalledTimes(2);
    expect(renderTitle.mock.calls[0][0]).toBe(rows[0]);
    expect(renderTitle.mock.calls[1][0]).toBe(rows[1]);
    expect(alpha.querySelector('mark')?.textContent).toBe('a');
    expect(alpha.getAttribute('title')).toBe('Alpha');
    expect(alpha.hasAttribute('aria-labelledby')).toBe(false);
    expect(view.getByRole('button', { name: 'b' }).getAttribute('title')).toBe(
      'b'
    );
    alpha.focus();
    for (const empty of [null, false] as const) {
      view.rerender(<ThreadList {...props} renderTitle={() => empty} />);
      expect(view.getByRole('button', { name: 'Alpha' })).toBe(alpha);
      expect(alpha.textContent).toBe('1 min ago');
      expect(document.activeElement).toBe(alpha);
    }
    view.rerender(
      <ThreadList
        {...props}
        threads={[rows[1], { id: 'a', title: 'Changed' }]}
        renderTitle={() => <em>replacement</em>}
      />
    );
    expect(view.getByRole('button', { name: 'Changed' })).toBe(alpha);
    expect(alpha.parentElement).toBe(row);
    expect(alpha.querySelector('em')?.textContent).toBe('replacement');
    expect(alpha.hasAttribute('aria-describedby')).toBe(false);
    expect(document.activeElement).toBe(alpha);
    fireEvent.click(alpha);
    fireEvent.click(view.getByRole('button', { name: '+ New thread' }));
    expect(onSelect.mock.calls).toEqual([['a']]);
    expect(onNewThread.mock.calls).toEqual([[]]);
    expect(alpha.getAttribute('aria-current')).toBe('true');
    view.rerender(<ThreadList {...props} />);
    expect(view.getByRole('button', { name: 'Alpha' })).toBe(alpha);
    expect(alpha.hasAttribute('aria-label')).toBe(false);
    expect(document.activeElement).toBe(alpha);
  });

  it.each([
    [0, 0, 'just now'],
    [-1, 0, 'just now'],
    [1, 0, 'just now'],
    [0, 59999, 'just now'],
    [0, 60000, '1 min ago'],
    [0, 3599999, '59 min ago'],
    [0, 3600000, '1 hr ago'],
    [0, 86399999, '23 hr ago'],
    [0, 86400000, '1 day ago'],
    [0, 172800000, '2 days ago'],
    [-60000, 0, '1 min ago'],
    [-8.64e15, -8.64e15, 'just now'],
    [8.64e15, 8.64e15, 'just now'],
    [-8.64e15, 8.64e15, '200000000 days ago'],
    [0.5, 60000.5, '1 min ago'],
  ])('describes updatedAt %s at %s as %s', (updatedAt, now, description) => {
    const view = render(
      <ThreadList
        threads={[{ id: 'a', title: 'Alpha', updatedAt }]}
        now={now}
        onSelect={() => undefined}
      />
    );
    const button = view.getByRole('button', { name: 'Alpha', description });
    const time = button.querySelector('time');
    expect(time).not.toBeNull();
    expect(time?.dateTime).toBe(new Date(updatedAt).toISOString());
    expect(time?.textContent).toBe(description);
    expect(
      document.getElementById(button.getAttribute('aria-describedby') ?? '')
    ).toBe(time);
  });

  it.each([undefined, NaN, Infinity, -Infinity, 8.64e15 + 1, -8.64e15 - 1])(
    'omits invalid or missing timestamp %s without changing plain markup',
    (updatedAt) => {
      const view = render(
        <ThreadList
          threads={[{ id: 'a', title: 'Alpha', updatedAt }]}
          now={0}
          onSelect={() => undefined}
        />
      );
      const button = view.getByRole('button', { name: 'Alpha' });
      expect(button.innerHTML).toBe('Alpha');
      expect(button.hasAttribute('aria-describedby')).toBe(false);
    }
  );

  it.each([NaN, Infinity, -Infinity, 8.64e15 + 1, -8.64e15 - 1])(
    'omits metadata for invalid reference %s',
    (now) => {
      const view = render(
        <ThreadList
          threads={[{ id: 'a', updatedAt: 0 }]}
          now={now}
          onSelect={() => undefined}
        />
      );
      expect(view.getByRole('button', { name: 'a' }).innerHTML).toBe('a');
    }
  );

  it('samples the default clock once per render and refreshes only when the owner renders', () => {
    vi.useFakeTimers();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(60000);
    const onSelect = vi.fn();
    const onNewThread = vi.fn();
    const props = {
      threads: [
        { id: 'a', updatedAt: 0 },
        { id: 'b', updatedAt: 0 },
      ],
      onSelect,
      onNewThread,
    };
    const view = render(<ThreadList {...props} />);
    expect(clock).toHaveBeenCalledTimes(1);
    expect(
      view.getByRole('button', { name: 'a', description: '1 min ago' })
    ).toBeTruthy();
    clock.mockReturnValue(120000);
    vi.advanceTimersByTime(120000);
    expect(vi.getTimerCount()).toBe(0);
    expect(clock).toHaveBeenCalledTimes(1);
    expect(
      view.getByRole('button', { name: 'a', description: '1 min ago' })
    ).toBeTruthy();
    view.rerender(<ThreadList {...props} />);
    expect(clock).toHaveBeenCalledTimes(2);
    expect(
      view.getByRole('button', { name: 'a', description: '2 min ago' })
    ).toBeTruthy();
    view.rerender(<ThreadList {...props} now={180000} />);
    expect(clock).toHaveBeenCalledTimes(2);
    expect(
      view.getByRole('button', { name: 'a', description: '3 min ago' })
    ).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onNewThread).not.toHaveBeenCalled();
  });

  it('associates duplicate lists independently and retains focused keyed rows through metadata, title and order changes', () => {
    const onSelect = vi.fn();
    const rows = Object.freeze([
      Object.freeze({ id: 'a:#[]', title: 'Alpha', updatedAt: 0 }),
      Object.freeze({ id: 'b', title: 'Beta', updatedAt: 0 }),
    ]);
    const lists = (reverse = false, now = 60000) => (
      <>
        <ThreadList
          threads={
            reverse
              ? [{ id: 'b', title: 'Changed', updatedAt: 60000 }, rows[0]]
              : rows
          }
          now={now}
          onSelect={onSelect}
        />
        <ThreadList threads={rows} now={now} onSelect={onSelect} />
      </>
    );
    const view = render(lists());
    const button = view.getAllByRole('button', {
      name: 'Beta',
      description: '1 min ago',
    })[0];
    const row = button.parentElement;
    button.focus();
    view.rerender(lists(true, 180000));
    expect(
      view.getByRole('button', { name: 'Changed', description: '2 min ago' })
    ).toBe(button);
    expect(button.parentElement).toBe(row);
    expect(document.activeElement).toBe(button);
    const ids = view.getAllByRole('button').flatMap((entry) => {
      const label = entry.getAttribute('aria-labelledby') ?? '';
      const description = entry.getAttribute('aria-describedby') ?? '';
      expect(entry.contains(document.getElementById(label))).toBe(true);
      expect(entry.contains(document.getElementById(description))).toBe(true);
      return [label, description];
    });
    expect(new Set(ids).size).toBe(ids.length);
    fireEvent.click(view.getAllByRole('button', { name: 'Alpha' })[0]);
    expect(onSelect.mock.calls).toEqual([['a:#[]']]);
    view.rerender(
      <ThreadList
        threads={[{ id: 'b', title: 'Changed' }]}
        now={0}
        onSelect={onSelect}
      />
    );
    // Metadata removal within the same list retains its native focus target.
    expect(view.getByRole('button', { name: 'Changed' })).toBe(button);
    expect(button.innerHTML).toBe('Changed');
    expect(document.activeElement).toBe(button);
    view.rerender(
      <ThreadList
        threads={[{ id: 'b', title: 'Changed', updatedAt: 0 }]}
        now={60000}
        onSelect={onSelect}
      />
    );
    expect(
      view.getByRole('button', { name: 'Changed', description: '1 min ago' })
    ).toBe(button);
    expect(button.parentElement).toBe(row);
    expect(document.activeElement).toBe(button);
  });
  it('omits the optional creation action without a callback', () => {
    const view = render(<ThreadList threads={[]} onSelect={() => undefined} />);
    expect(view.container.firstElementChild).toBe(view.getByRole('list'));
    expect(view.queryByRole('button')).toBeNull();
  });

  it('requests creation without changing controlled selection or replacing rows', () => {
    const onNewThread = vi.fn();
    const onSelect = vi.fn();
    const props = {
      threads: [{ id: 'a', title: 'Alpha' }],
      activeThreadId: 'a',
      onSelect,
    };
    const view = render(
      <ThreadList
        {...props}
        onNewThread={onNewThread}
        className="custom-list"
      />,
      { wrapper: StrictMode }
    );
    const list = view.getByRole('list', { name: 'Conversations' });
    const alpha = view.getByRole('button', { name: 'Alpha' });
    const create = view.getByRole('button', { name: '+ New thread' });
    expect(create.getAttribute('type')).toBe('button');
    expect(list.contains(create)).toBe(false);
    expect(list.classList.contains('custom-list')).toBe(true);
    expect(onNewThread).not.toHaveBeenCalled();
    fireEvent.click(create);
    expect(onNewThread.mock.calls).toEqual([[]]);
    expect(alpha.getAttribute('aria-current')).toBe('true');
    expect(onSelect).not.toHaveBeenCalled();
    const replacement = vi.fn();
    view.rerender(
      <ThreadList
        {...props}
        onNewThread={replacement}
        newThreadLabel={'<b>Create</b>'}
        newThreadDisabled
      />
    );
    const disabled = view.getByRole('button', { name: '<b>Create</b>' });
    expect(disabled.querySelector('b')).toBeNull();
    expect((disabled as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(disabled);
    expect(replacement).not.toHaveBeenCalled();
    expect(view.getByRole('button', { name: 'Alpha' })).toBe(alpha);
    fireEvent.click(alpha);
    expect(onSelect.mock.calls).toEqual([['a']]);
    view.rerender(<ThreadList {...props} onNewThread={replacement} />);
    fireEvent.click(view.getByRole('button', { name: '+ New thread' }));
    expect(replacement.mock.calls).toEqual([[]]);
    expect(onNewThread).toHaveBeenCalledTimes(1);
    expect(view.getByRole('list')).toBe(list);
  });

  it('renders ordered plain labels with full ID fallbacks and native semantics', () => {
    const onSelect = vi.fn();
    const threads = Object.freeze([
      Object.freeze({ id: 'first', title: '<b>**Plain**</b>' }),
      Object.freeze({ id: 'full-special-id:#[]"', title: '' }),
      Object.freeze({ id: 'third' }),
      Object.freeze({ id: 'space', title: '   ' }),
    ]);
    const view = render(<ThreadList threads={threads} onSelect={onSelect} />);
    const list = view.getByRole('list', { name: 'Conversations' });
    expect(list.tagName).toBe('UL');
    expect(
      view.getAllByRole('listitem').every((row) => row.tagName === 'LI')
    ).toBe(true);
    const buttons = view.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      '<b>**Plain**</b>',
      'full-special-id:#[]"',
      'third',
      '   ',
    ]);
    expect(buttons.map((button) => button.getAttribute('title'))).toEqual(
      buttons.map((button) => button.textContent)
    );
    expect(
      buttons.every((button) => button.getAttribute('type') === 'button')
    ).toBe(true);
    expect(list.querySelector('b, strong')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(buttons[1]);
    expect(onSelect.mock.calls).toEqual([['full-special-id:#[]"']]);
  });

  it('leaves selection controlled even when the owner refuses a request', () => {
    const threads = [
      { id: 'a', title: 'Alpha' },
      { id: 'b', title: 'Beta' },
    ];
    const onSelect = vi.fn();
    const view = render(
      <StrictMode>
        <ThreadList threads={threads} activeThreadId="a" onSelect={onSelect} />
      </StrictMode>
    );
    const alpha = view.getByRole('button', { name: 'Alpha' });
    const beta = view.getByRole('button', { name: 'Beta' });
    fireEvent.click(beta);
    expect(onSelect.mock.calls).toEqual([['b']]);
    expect(alpha.getAttribute('aria-current')).toBe('true');
    expect(beta.hasAttribute('aria-current')).toBe(false);
    for (const activeThreadId of ['b', null, 'missing', undefined]) {
      view.rerender(
        <ThreadList
          threads={threads}
          activeThreadId={activeThreadId}
          onSelect={onSelect}
        />
      );
      expect(
        view.container.querySelectorAll('[aria-current="true"]').length
      ).toBe(activeThreadId === 'b' ? 1 : 0);
    }
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('retains surviving row and button identity and focus through new objects, reorder and filtering', () => {
    const onSelect = vi.fn();
    const view = render(
      <ThreadList
        threads={[
          { id: 'a', title: 'Alpha' },
          { id: 'b', title: 'Beta' },
        ]}
        onSelect={onSelect}
      />
    );
    const button = view.getByRole('button', { name: 'Beta' });
    const row = button.parentElement;
    button.focus();
    for (const threads of [
      [
        { id: 'b', title: 'Updated Beta' },
        { id: 'a', title: 'Alpha' },
      ],
      [{ id: 'b', title: 'Updated Beta' }],
    ]) {
      view.rerender(
        <ThreadList threads={threads} activeThreadId="b" onSelect={onSelect} />
      );
      expect(view.getByRole('button', { name: 'Updated Beta' })).toBe(button);
      expect(button.parentElement).toBe(row);
      expect(document.activeElement).toBe(button);
      expect(button.getAttribute('aria-current')).toBe('true');
    }
    view.rerender(
      <ThreadList
        threads={[]}
        onSelect={onSelect}
        label="Loaded threads"
        className="consumer-list"
      />
    );
    const list = view.getByRole('list', { name: 'Loaded threads' });
    expect(list.classList.contains('tp-thread-list')).toBe(true);
    expect(list.classList.contains('consumer-list')).toBe(true);
    expect(list.childElementCount).toBe(0);
    expect(list.textContent).toBe('');
    expect(button.isConnected).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
