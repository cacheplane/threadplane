import { StrictMode } from 'react';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistorySearchPalette } from './index';

const rows = Object.freeze([
  Object.freeze({ id: ' a/one ', title: 'Alpha', subtitle: 'Project one' }),
  Object.freeze({
    id: '__proto__',
    title: '<img src=x onerror=alert(1)>',
    subtitle: 'Archived',
  }),
  Object.freeze({ id: 'c', title: 'Charlie' }),
]);
const props = () => ({
  open: true,
  query: '',
  results: rows,
  onQueryChange: vi.fn(),
  onSelect: vi.fn(),
  onClose: vi.fn(),
});
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    }),
  });
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    {},
  ] as unknown as DOMRectList);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HistorySearchPalette', () => {
  it('exports the controlled primitive and renders only a marker on the server', () => {
    expect(typeof HistorySearchPalette).toBe('function');
    const p = props();
    for (const open of [false, true]) {
      const html = renderToString(<HistorySearchPalette {...p} open={open} />);
      expect(html).toContain('hidden');
      expect(html).not.toContain('<dialog');
    }
    expect(p.onSelect).not.toHaveBeenCalled();
  });

  it('opens an owner-body native modal with labelled combobox, literal supplied-order results and input focus', () => {
    const p = props();
    const view = render(
      <HistorySearchPalette {...p} description="Loaded titles only" />
    );
    const dialog = view.getByRole('dialog', { name: 'Search conversations' });
    const input = within(dialog).getByRole('combobox', {
      name: 'Search conversations',
    });
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(input);
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();
    expect(
      document.getElementById(input.getAttribute('aria-controls') ?? '')
    ).toBe(within(dialog).getByRole('listbox'));
    expect(view.getAllByRole('option').map((row) => row.textContent)).toEqual([
      'AlphaProject one',
      '<img src=x onerror=alert(1)>Archived',
      'Charlie',
    ]);
    expect(dialog.querySelector('img')).toBeNull();
    expect(
      document.getElementById(dialog.getAttribute('aria-describedby') ?? '')
        ?.textContent
    ).toBe('Loaded titles only');
    fireEvent.click(view.getAllByRole('option')[0]);
    expect(p.onSelect).toHaveBeenCalledExactlyOnceWith(' a/one ');
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(rows.map((row) => row.id)).toEqual([' a/one ', '__proto__', 'c']);
  });

  it('leaves query/open caller-owned and preserves modal/input across callback and data updates', () => {
    const p = props();
    const view = render(<HistorySearchPalette {...p} query="initial" />);
    const dialog = view.getByRole('dialog');
    const input = view.getByRole('combobox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'requested' } });
    expect(p.onQueryChange).toHaveBeenCalledExactlyOnceWith('requested');
    expect(input.value).toBe('initial');
    const selected = vi.fn();
    view.rerender(
      <HistorySearchPalette
        {...p}
        query="requested"
        label="Loaded search"
        onSelect={selected}
      />
    );
    expect(view.getByRole('dialog')).toBe(dialog);
    expect(view.getByRole('combobox')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('requested');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(selected).toHaveBeenCalledExactlyOnceWith(' a/one ');
    expect(p.onSelect).not.toHaveBeenCalled();
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();
  });

  it('clamps arrow movement, retains exact identity on reorder, resets on query/removal and reopens at first result', () => {
    const p = props();
    const view = render(<HistorySearchPalette {...p} />);
    const input = view.getByRole('combobox');
    const active = () =>
      document.getElementById(input.getAttribute('aria-activedescendant') ?? '')
        ?.textContent;
    expect(active()).toBe('AlphaProject one');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(active()).toBe('AlphaProject one');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(active()).toBe('<img src=x onerror=alert(1)>Archived');
    view.rerender(
      <HistorySearchPalette {...p} results={[rows[2], rows[1], rows[0]]} />
    );
    expect(active()).toBe('<img src=x onerror=alert(1)>Archived');
    view.rerender(
      <HistorySearchPalette
        {...p}
        query="new"
        results={[rows[2], rows[1], rows[0]]}
      />
    );
    expect(active()).toBe('Charlie');
    fireEvent.keyDown(input, { key: 'ArrowDown', repeat: true });
    expect(active()).toBe('<img src=x onerror=alert(1)>Archived');
    view.rerender(
      <HistorySearchPalette {...p} query="new" results={[rows[0]]} />
    );
    expect(active()).toBe('AlphaProject one');
    view.rerender(<HistorySearchPalette {...p} query="new" results={[]} />);
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.onSelect).not.toHaveBeenCalled();
    view.rerender(<HistorySearchPalette {...p} open={false} />);
    expect(view.queryByRole('dialog')).toBeNull();
    view.rerender(<HistorySearchPalette {...p} />);
    expect(
      document.getElementById(
        view.getByRole('combobox').getAttribute('aria-activedescendant') ?? ''
      )?.textContent
    ).toBe('AlphaProject one');
  });

  it('retains initial and fallback identities through reorder without resurrecting removed results', () => {
    const p = props();
    const view = render(<HistorySearchPalette {...p} />);
    const active = () =>
      document.getElementById(
        view.getByRole('combobox').getAttribute('aria-activedescendant') ?? ''
      )?.textContent;
    view.rerender(
      <HistorySearchPalette {...p} results={[rows[2], rows[0], rows[1]]} />
    );
    expect(active()).toBe('AlphaProject one');
    view.rerender(
      <HistorySearchPalette
        {...p}
        query="new"
        results={[rows[2], rows[0], rows[1]]}
      />
    );
    expect(active()).toBe('Charlie');
    view.rerender(
      <HistorySearchPalette
        {...p}
        query="new"
        results={[rows[1], rows[2], rows[0]]}
      />
    );
    expect(active()).toBe('Charlie');
    view.rerender(
      <HistorySearchPalette {...p} query="new" results={[rows[0], rows[1]]} />
    );
    expect(active()).toBe('AlphaProject one');
    view.rerender(
      <HistorySearchPalette
        {...p}
        query="new"
        results={[rows[2], rows[1], rows[0]]}
      />
    );
    expect(active()).toBe('AlphaProject one');
  });

  it('resets identity for committed query changes during loading, including a query roundtrip', () => {
    const p = props();
    const view = render(<HistorySearchPalette {...p} />);
    const input = view.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    view.rerender(<HistorySearchPalette {...p} loading />);
    view.rerender(<HistorySearchPalette {...p} query="changed" loading />);
    view.rerender(<HistorySearchPalette {...p} loading />);
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.onSelect).not.toHaveBeenCalled();
    view.rerender(<HistorySearchPalette {...p} />);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.onSelect).toHaveBeenCalledExactlyOnceWith(rows[0].id);
  });

  it('announces empty/hint/loading and blocks stale retained-result selection while loading', () => {
    const p = props();
    const view = render(<HistorySearchPalette {...p} results={[]} />);
    const input = view.getByRole('combobox');
    expect(view.getByRole('status').textContent).toBe(
      'Type a conversation title.'
    );
    expect(
      document.getElementById(input.getAttribute('aria-controls') ?? '')
    ).toBe(view.getByRole('listbox'));
    view.rerender(<HistorySearchPalette {...p} query="missing" results={[]} />);
    expect(view.getByRole('status').textContent).toBe(
      'No conversations match.'
    );
    view.rerender(<HistorySearchPalette {...p} loading />);
    expect(view.getByRole('status').textContent).toBe('Loading results…');
    expect(view.getByRole('listbox').getAttribute('aria-busy')).toBe('true');
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    fireEvent.click(view.getAllByRole('option')[0]);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.onSelect).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: 'Close search' }));
    expect(p.onClose).toHaveBeenCalledOnce();
  });

  it.each([
    { isComposing: true },
    { keyCode: 229 },
    { repeat: true },
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
  ])(
    'ignores modified/IME/repeated activation %j and retains keyboard ownership',
    (flags) => {
      const p = props();
      const outer = vi.fn();
      const view = render(
        <div onKeyDown={outer}>
          <HistorySearchPalette {...p} />
        </div>
      );
      const input = view.getByRole('combobox');
      for (const key of ['Enter', 'Escape'])
        fireEvent.keyDown(input, { key, ...flags });
      fireEvent(
        view.getByRole('dialog'),
        new Event('cancel', { cancelable: true })
      );
      expect(p.onSelect).not.toHaveBeenCalled();
      expect(p.onClose).not.toHaveBeenCalled();
      expect(outer).not.toHaveBeenCalled();
      fireEvent.keyUp(input, { key: 'Escape' });
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(p.onClose).toHaveBeenCalledOnce();
    }
  );

  it('honors claimed keyboard events and a live composition even with false per-event flags', () => {
    const p = props();
    const view = render(
      <div onKeyDownCapture={(e) => e.preventDefault()}>
        <HistorySearchPalette {...p} />
      </div>
    );
    const input = view.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(p.onSelect).not.toHaveBeenCalled();
    expect(p.onClose).not.toHaveBeenCalled();
    view.rerender(<HistorySearchPalette {...p} />);
    const current = view.getByRole('combobox');
    fireEvent.compositionStart(current);
    fireEvent.keyDown(current, { key: 'ArrowDown', isComposing: false });
    fireEvent.keyDown(current, { key: 'Enter', isComposing: false });
    fireEvent.keyDown(current, { key: 'Escape', isComposing: false });
    fireEvent(
      view.getByRole('dialog'),
      new Event('cancel', { cancelable: true })
    );
    expect(p.onSelect).not.toHaveBeenCalled();
    expect(p.onClose).not.toHaveBeenCalled();
    fireEvent.compositionEnd(current);
    fireEvent.keyUp(current, { key: 'Escape' });
    fireEvent.keyDown(current, { key: 'Enter' });
    expect(p.onSelect).toHaveBeenCalledExactlyOnceWith(' a/one ');
  });

  it('deduplicates one Escape/native cancel pair while leaving subsequent controlled requests available', () => {
    const p = props();
    const view = render(<HistorySearchPalette {...p} />);
    const dialog = view.getByRole('dialog');
    const input = view.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'Escape' });
    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(p.onClose).toHaveBeenCalledOnce();
    fireEvent.keyUp(input, { key: 'Escape' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalledTimes(2);
    fireEvent.blur(window);
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(p.onClose).toHaveBeenCalledTimes(3);
    expect(dialog.hasAttribute('open')).toBe(true);
  });

  it('keeps Tab within input/close and suppresses an ignored close-button Space release after composition ends', () => {
    const p = props();
    const view = render(<HistorySearchPalette {...p} />);
    const input = view.getByRole('combobox');
    const close = view.getByRole('button', { name: 'Close search' });
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(document.activeElement).toBe(input);
    close.focus();
    fireEvent.compositionStart(close);
    const down = new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true,
    });
    fireEvent(close, down);
    fireEvent.compositionEnd(close);
    const up = new KeyboardEvent('keyup', {
      key: ' ',
      bubbles: true,
      cancelable: true,
    });
    fireEvent(close, up);
    expect(down.defaultPrevented).toBe(true);
    expect(up.defaultPrevented).toBe(true);
    expect(p.onClose).not.toHaveBeenCalled();
    const ordinary = new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true,
    });
    fireEvent(close, ordinary);
    expect(ordinary.defaultPrevented).toBe(false);
    fireEvent.click(close);
    expect(p.onClose).toHaveBeenCalledOnce();
  });

  it.each([
    { repeat: true },
    { keyCode: 229 },
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
  ])('owns the release of an ignored close-button Space press %j', (flags) => {
    const p = props();
    const view = render(<HistorySearchPalette {...p} />);
    const close = view.getByRole('button', { name: 'Close search' });
    close.focus();
    const down = new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true,
      ...flags,
    });
    const up = new KeyboardEvent('keyup', {
      key: ' ',
      bubbles: true,
      cancelable: true,
    });
    fireEvent(close, down);
    fireEvent(close, up);
    expect(down.defaultPrevented).toBe(true);
    expect(up.defaultPrevented).toBe(true);
    expect(p.onClose).not.toHaveBeenCalled();
  });

  it.each(['blur', 'visibility'])(
    'rejects orphan button releases after %s but accepts a fresh press',
    (event) => {
      const p = props();
      const view = render(<HistorySearchPalette {...p} />);
      const close = view.getByRole('button', { name: 'Close search' });
      close.focus();
      fireEvent.keyDown(close, { key: ' ', isComposing: true });
      if (event === 'blur') fireEvent.blur(window);
      else {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        fireEvent(document, new Event('visibilitychange'));
      }
      const orphan = new KeyboardEvent('keyup', {
        key: ' ',
        bubbles: true,
        cancelable: true,
      });
      fireEvent(close, orphan);
      expect(orphan.defaultPrevented).toBe(true);
      const down = new KeyboardEvent('keydown', {
        key: ' ',
        bubbles: true,
        cancelable: true,
      });
      const up = new KeyboardEvent('keyup', {
        key: ' ',
        bubbles: true,
        cancelable: true,
      });
      fireEvent(close, down);
      fireEvent(close, up);
      expect(down.defaultPrevented).toBe(false);
      expect(up.defaultPrevented).toBe(false);
      fireEvent.click(close);
      expect(p.onClose).toHaveBeenCalledOnce();
    }
  );

  it('dismisses only a real backdrop click and restores the original available invoker', () => {
    const invoker = document.createElement('button');
    document.body.append(invoker);
    invoker.focus();
    const p = props();
    const view = render(
      <HistorySearchPalette {...p} returnFocusTo={invoker} />
    );
    const dialog = view.getByRole('dialog');
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 10,
      right: 200,
      bottom: 200,
    } as DOMRect);
    fireEvent.click(dialog, { clientX: 20, clientY: 20 });
    fireEvent.click(view.getByRole('combobox'), { clientX: 0, clientY: 0 });
    expect(p.onClose).not.toHaveBeenCalled();
    fireEvent.click(dialog, { clientX: 0, clientY: 0 });
    expect(p.onClose).toHaveBeenCalledOnce();
    view.rerender(<HistorySearchPalette {...p} open={false} />);
    expect(document.activeElement).toBe(invoker);
    invoker.remove();
  });

  it('does not steal deliberately moved focus or restore disconnected, hidden or foreign targets', () => {
    const invoker = document.createElement('button');
    const outside = document.createElement('button');
    document.body.append(invoker, outside);
    invoker.focus();
    const p = props();
    const view = render(<HistorySearchPalette {...p} />);
    outside.focus();
    view.rerender(<HistorySearchPalette {...p} open={false} />);
    expect(document.activeElement).toBe(outside);
    invoker.focus();
    view.rerender(<HistorySearchPalette {...p} />);
    invoker.hidden = true;
    view.unmount();
    expect(document.activeElement).not.toBe(invoker);
    invoker.remove();
    outside.remove();
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const foreignDocument = frame.contentDocument;
    if (!foreignDocument) throw new Error('Missing frame document');
    const foreign = foreignDocument.createElement('button');
    foreignDocument.body.append(foreign);
    const other = render(
      <HistorySearchPalette {...p} returnFocusTo={foreign} />
    );
    other.unmount();
    expect(foreignDocument.activeElement).not.toBe(foreign);
    frame.remove();
  });

  it('retains local theme/RTL and unique active IDs and survives StrictMode without requests', () => {
    const p = props();
    const view = render(
      <StrictMode>
        <div dir="rtl" style={{ fontFamily: 'monospace' }}>
          <HistorySearchPalette {...p} />
          <HistorySearchPalette {...p} label="Other search" />
        </div>
      </StrictMode>
    );
    const inputs = view.getAllByRole('combobox');
    expect(
      new Set(inputs.map((input) => input.getAttribute('aria-controls'))).size
    ).toBe(2);
    for (const input of inputs)
      expect(
        document.getElementById(
          input.getAttribute('aria-activedescendant') ?? ''
        )
      ).toBeTruthy();
    for (const dialog of view.getAllByRole('dialog')) {
      expect(dialog.getAttribute('dir')).toBe('rtl');
      expect(dialog.style.fontFamily).toBe('monospace');
    }
    expect(p.onSelect).not.toHaveBeenCalled();
    expect(p.onClose).not.toHaveBeenCalled();
    view.unmount();
    expect(document.querySelectorAll('dialog')).toHaveLength(0);
  });
});
