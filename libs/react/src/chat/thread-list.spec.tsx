import { StrictMode } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThreadList } from './index';

afterEach(cleanup);

describe('ThreadList', () => {
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
