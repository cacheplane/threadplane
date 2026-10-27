import { StrictMode } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatSidenav, type ChatSidenavProps } from './index';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const base = {
  mode: 'expanded',
  open: false,
  onOpenChange: vi.fn(),
  onModeChange: vi.fn(),
} satisfies ChatSidenavProps;
function key(target: EventTarget = window, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: 'k',
    ctrlKey: true,
    bubbles: true,
    composed: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe('ChatSidenav search requests', () => {
  it('renders only for a callback, uses literal labels and requests once with zero arguments', () => {
    const first = vi.fn();
    const latest = vi.fn();
    const view = render(<ChatSidenav {...base} searchShortcut />);
    expect(view.queryByText('Search conversations')).toBeNull();
    expect(key().defaultPrevented).toBe(false);
    view.rerender(<ChatSidenav {...base} onSearch={first} />);
    const search = view.getByRole('button', { name: 'Search conversations' });
    expect(search.getAttribute('type')).toBe('button');
    expect(search.getAttribute('title')).toBe('Search conversations');
    expect(search.hasAttribute('aria-keyshortcuts')).toBe(false);
    expect(key().defaultPrevented).toBe(false);
    expect(search.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
    expect(search.querySelector('svg')?.getAttribute('stroke')).toBe(
      'currentColor'
    );
    expect(search.querySelector('svg')?.getAttribute('width')).toBe('20');
    expect(search.closest('.tp-chat-sidenav__body')).toBeNull();
    search.focus();
    fireEvent.click(search);
    expect(first.mock.calls).toEqual([[]]);
    expect(document.activeElement).toBe(search);
    view.rerender(
      <ChatSidenav
        {...base}
        mode="collapsed"
        searchLabel="Find <loaded> & saved"
        onSearch={latest}
      />
    );
    const renamed = view.getByRole('button', { name: 'Find <loaded> & saved' });
    expect(renamed.textContent).toBe('Find <loaded> & saved');
    fireEvent.click(renamed);
    expect(latest.mock.calls).toEqual([[]]);
    expect(first).toHaveBeenCalledTimes(1);
    expect(base.onModeChange).not.toHaveBeenCalled();
    expect(base.onOpenChange).not.toHaveBeenCalled();
  });

  it('claims supported K chords in all modes before calling the latest committed owner', () => {
    let event: KeyboardEvent;
    const first = vi.fn(() => expect(event.defaultPrevented).toBe(true));
    const latest = vi.fn();
    const view = render(
      <ChatSidenav {...base} onSearch={first} searchShortcut />
    );
    const search = view.getByRole('button', { name: 'Search conversations' });
    expect(search.getAttribute('title')).toBe(
      'Search conversations (Ctrl/Command+K)'
    );
    expect(search.getAttribute('aria-keyshortcuts')).toBe('Control+K Meta+K');
    for (const init of [
      {},
      { key: 'K', ctrlKey: false, metaKey: true },
      { metaKey: true },
    ]) {
      event = new KeyboardEvent('keydown', {
        key: 'k',
        ctrlKey: true,
        cancelable: true,
        ...init,
      });
      window.dispatchEvent(event);
    }
    expect(first.mock.calls).toEqual([[], [], []]);
    for (const [mode, open] of [
      ['expanded', false],
      ['collapsed', false],
      ['drawer', false],
      ['drawer', true],
    ] as const) {
      view.rerender(
        <ChatSidenav
          {...base}
          mode={mode}
          open={open}
          onSearch={latest}
          searchShortcut
          toggleShortcut
        />
      );
      expect(key().defaultPrevented).toBe(true);
      if (mode === 'drawer')
        expect(key(window, { key: 'b' }).defaultPrevented).toBe(false);
      if (mode === 'drawer' && !open) {
        expect(
          view.queryByRole('button', { name: 'Search conversations' })
        ).toBeNull();
        expect(view.container.querySelector('nav')?.hasAttribute('inert')).toBe(
          true
        );
      }
    }
    expect(latest.mock.calls).toEqual([[], [], [], []]);
    for (const enabled of [false, undefined, 'true' as unknown as boolean]) {
      view.rerender(
        <ChatSidenav {...base} onSearch={latest} searchShortcut={enabled} />
      );
      expect(key().defaultPrevented).toBe(false);
    }
  });

  it('ignores ineligible events, local interception and editable composed paths', () => {
    const onSearch = vi.fn();
    const view = render(
      <ChatSidenav {...base} onSearch={onSearch} searchShortcut>
        <input />
        <textarea />
        <select />
        <div contentEditable suppressContentEditableWarning>
          <span>Editable</span>
          <button contentEditable={false}>Island</button>
        </div>
        <button onKeyDown={(e) => e.preventDefault()}>Claim</button>
        <button onKeyDown={(e) => e.stopPropagation()}>Stop</button>
        <div data-testid="host" />
      </ChatSidenav>
    );
    for (const init of [
      { cancelable: false },
      { repeat: true },
      { isComposing: true },
      { keyCode: 229 },
      { altKey: true },
      { shiftKey: true },
      { ctrlKey: false },
      { key: 'j' },
    ])
      expect(key(window, init).defaultPrevented).toBe(false);
    const claimed = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      cancelable: true,
    });
    claimed.preventDefault();
    window.dispatchEvent(claimed);
    for (const element of view.container.querySelectorAll(
      'input,textarea,select'
    ))
      expect(key(element).defaultPrevented).toBe(false);
    expect(key(view.getByText('Editable')).defaultPrevented).toBe(false);
    key(view.getByText('Claim'));
    key(view.getByText('Stop'));
    const shadow = view.getByTestId('host').attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    shadow.append(input);
    expect(key(input).defaultPrevented).toBe(false);
    expect(onSearch).not.toHaveBeenCalled();
    expect(key(view.getByText('Island')).defaultPrevented).toBe(true);
    expect(onSearch.mock.calls).toEqual([[]]);
  });

  it('keeps one shared listener lifetime and first eligible owner priority as flags change', () => {
    const one = vi.fn();
    const two = vi.fn();
    const bOne = vi.fn();
    const bTwo = vi.fn();
    const add = vi.spyOn(window, 'addEventListener');
    const owners = (
      b = false,
      k = true,
      callback: (() => void) | null = one
    ) => (
      <>
        <ChatSidenav
          {...base}
          onModeChange={bOne}
          toggleShortcut={b}
          onSearch={callback ?? undefined}
          searchShortcut={k}
        />
        <ChatSidenav
          {...base}
          onModeChange={bTwo}
          toggleShortcut
          onSearch={two}
          searchShortcut
        />
      </>
    );
    const view = render(owners());
    expect(key().defaultPrevented).toBe(true);
    expect(one).toHaveBeenCalledTimes(1);
    key(window, { key: 'b' });
    expect(bTwo).toHaveBeenCalledTimes(1);
    const registrations = add.mock.calls.filter(
      ([name]) => name === 'keydown'
    ).length;
    view.rerender(owners(true));
    key(window, { key: 'b' });
    expect(bOne).toHaveBeenCalledTimes(1);
    view.rerender(owners(false));
    key(window, { key: 'b' });
    expect(bTwo).toHaveBeenCalledTimes(2);
    view.rerender(owners(true, false));
    key();
    expect(two).toHaveBeenCalledTimes(1);
    view.rerender(owners(true, true, null));
    key();
    expect(two).toHaveBeenCalledTimes(2);
    expect(add.mock.calls.filter(([name]) => name === 'keydown')).toHaveLength(
      registrations
    );
  });

  it('skips hidden, inert and disconnected owners and cleans up StrictMode and iframe listeners', () => {
    const onSearch = vi.fn();
    const view = render(
      <StrictMode>
        <div data-testid="owner">
          <ChatSidenav {...base} onSearch={onSearch} searchShortcut />
        </div>
      </StrictMode>
    );
    const owner = view.getByTestId('owner');
    for (const attribute of ['hidden', 'inert']) {
      owner.setAttribute(attribute, '');
      expect(key().defaultPrevented).toBe(false);
      owner.removeAttribute(attribute);
    }
    owner.remove();
    expect(key().defaultPrevented).toBe(false);
    view.container.append(owner);
    view.unmount();
    expect(key().defaultPrevented).toBe(false);
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    if (!win || !doc) throw new Error('Expected a connected same-origin frame');
    const foreign = render(
      <ChatSidenav {...base} onSearch={onSearch} searchShortcut />,
      { container: doc.body }
    );
    expect(key().defaultPrevented).toBe(false);
    const event = new (win as unknown as typeof window).KeyboardEvent(
      'keydown',
      { key: 'k', metaKey: true, cancelable: true }
    );
    win.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onSearch.mock.calls).toEqual([[]]);
    foreign.unmount();
    frame.remove();
  });

  it('preserves first owner priority across modes and callback replacement until both flags opt out', () => {
    const first = vi.fn();
    const replacement = vi.fn();
    const second = vi.fn();
    const owners = (
      mode: ChatSidenavProps['mode'],
      callback: () => void,
      enabled = true
    ) => (
      <>
        <ChatSidenav
          {...base}
          mode={mode}
          onSearch={callback}
          searchShortcut={enabled}
        />
        <ChatSidenav {...base} onSearch={second} searchShortcut />
      </>
    );
    const view = render(owners('expanded', first));
    key();
    expect(first).toHaveBeenCalledTimes(1);
    for (const mode of ['drawer', 'collapsed', 'expanded'] as const) {
      view.rerender(owners(mode, replacement));
      key();
      expect(second).not.toHaveBeenCalled();
    }
    expect(replacement).toHaveBeenCalledTimes(3);
    view.rerender(owners('expanded', replacement, false));
    key();
    expect(second).toHaveBeenCalledTimes(1);
    view.rerender(owners('expanded', replacement));
    key();
    expect(second).toHaveBeenCalledTimes(2);
    expect(replacement).toHaveBeenCalledTimes(3);
  });

  it('skips hidden or inert shadow hosts so the next eligible owner can claim K', () => {
    const first = vi.fn();
    const second = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const container = document.createElement('div');
    shadow.append(container);
    const view = render(
      <ChatSidenav {...base} onSearch={first} searchShortcut />,
      { container }
    );
    render(<ChatSidenav {...base} onSearch={second} searchShortcut />);
    for (const attribute of ['hidden', 'inert']) {
      host.setAttribute(attribute, '');
      key();
      expect(first).not.toHaveBeenCalled();
      host.removeAttribute(attribute);
    }
    expect(second).toHaveBeenCalledTimes(2);
    key();
    expect(first).toHaveBeenCalledTimes(1);
    view.unmount();
    host.remove();
  });

  it('retains visible search focus across desktop modes and restores only owned closed drawer focus', () => {
    const onSearch = vi.fn();
    const view = render(<ChatSidenav {...base} onSearch={onSearch} />);
    const search = view.getByRole('button', { name: 'Search conversations' });
    search.focus();
    view.rerender(
      <ChatSidenav {...base} mode="collapsed" onSearch={onSearch} />
    );
    expect(document.activeElement).toBe(search);
    view.rerender(
      <ChatSidenav {...base} mode="drawer" open onSearch={onSearch} />
    );
    search.focus();
    search.blur();
    view.rerender(<ChatSidenav {...base} mode="drawer" onSearch={onSearch} />);
    expect(document.activeElement).toBe(
      view.getByRole('button', { name: 'Open conversations' })
    );
    view.rerender(
      <ChatSidenav {...base} mode="drawer" open onSearch={onSearch} />
    );
    search.focus();
    const external = document.createElement('button');
    document.body.append(external);
    external.focus();
    view.rerender(<ChatSidenav {...base} mode="drawer" onSearch={onSearch} />);
    expect(document.activeElement).toBe(external);
    external.remove();
  });
});
