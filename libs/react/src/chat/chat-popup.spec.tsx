import { StrictMode, useEffect, useState } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPopup, ChatSidebar } from './index';

afterEach(cleanup);

describe('ChatPopup', () => {
  it.each([ChatPopup, ChatSidebar])(
    'keeps fixed chrome within the unzoomed visible viewport and releases listeners',
    (Shell) => {
      const previous = Object.getOwnPropertyDescriptor(
        window,
        'visualViewport'
      );
      const viewport = Object.assign(new EventTarget(), {
        height: 714,
        offsetTop: 0,
        scale: 1,
      });
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: viewport,
      });
      try {
        const view = render(
          <StrictMode>
            <Shell open title="Support" onOpenChange={vi.fn()}>
              <textarea aria-label="Draft" />
            </Shell>
          </StrictMode>
        );
        const root =
          view.container.querySelector<HTMLElement>('.tp-chat-popup')!;
        expect(root.style.getPropertyValue('--tp-chat-viewport-height')).toBe(
          '714px'
        );
        viewport.height = 377;
        viewport.offsetTop = 194;
        viewport.dispatchEvent(new Event('resize'));
        expect(root.style.getPropertyValue('--tp-chat-viewport-height')).toBe(
          '377px'
        );
        expect(root.style.getPropertyValue('--tp-chat-viewport-top')).toBe(
          '194px'
        );
        viewport.offsetTop = 267;
        viewport.dispatchEvent(new Event('scroll'));
        expect(root.style.getPropertyValue('--tp-chat-viewport-top')).toBe(
          '267px'
        );
        viewport.scale = 2;
        viewport.height = 200;
        viewport.dispatchEvent(new Event('resize'));
        expect(root.style.getPropertyValue('--tp-chat-viewport-height')).toBe(
          '377px'
        );
        view.unmount();
        viewport.scale = 1;
        viewport.height = 714;
        viewport.dispatchEvent(new Event('resize'));
        expect(root.style.getPropertyValue('--tp-chat-viewport-height')).toBe(
          '377px'
        );
      } finally {
        if (previous) Object.defineProperty(window, 'visualViewport', previous);
        else Reflect.deleteProperty(window, 'visualViewport');
      }
    }
  );

  it('keeps closed content mounted, hidden and inert without moving focus', () => {
    const view = render(
      <ChatPopup open={false} onOpenChange={vi.fn()} title="Support">
        <textarea aria-label="Draft" defaultValue="Retained" />
      </ChatPopup>
    );
    const panel = view.container.querySelector('[role="dialog"]');
    expect(panel?.hasAttribute('hidden')).toBe(true);
    expect(panel?.hasAttribute('inert')).toBe(true);
    expect(view.queryByRole('dialog')).toBeNull();
    expect(panel?.querySelector('textarea')?.value).toBe('Retained');
    expect(document.activeElement).toBe(document.body);
    const launcher = view.getByRole('button', { name: 'Chat' });
    expect(launcher.getAttribute('aria-haspopup')).toBe('dialog');
    expect(launcher.getAttribute('aria-controls')).toBe(panel?.id);
    expect(launcher.getAttribute('aria-expanded')).toBe('false');
  });

  it('requests changes but waits for accepted props before changing visibility or focus', () => {
    const change = vi.fn();
    const popup = (open: boolean) => (
      <ChatPopup open={open} onOpenChange={change} title="Support">
        <input aria-label="Message" />
      </ChatPopup>
    );
    const view = render(popup(false));
    const launcher = view.getByRole('button', { name: 'Chat' });
    launcher.focus();
    fireEvent.click(launcher);
    expect(change).toHaveBeenLastCalledWith(true);
    view.rerender(popup(false));
    expect(view.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(launcher);
    view.rerender(popup(true));
    const close = view.getByRole('button', { name: 'Close chat' });
    expect(document.activeElement).toBe(close);
    expect(launcher.getAttribute('aria-expanded')).toBe('true');
    const input = view.getByRole('textbox');
    input.focus();
    view.rerender(popup(true));
    expect(document.activeElement).toBe(input);
    fireEvent.click(close);
    expect(change).toHaveBeenLastCalledWith(false);
    view.rerender(popup(true));
    expect(view.getByRole('dialog', { name: 'Support' })).toBeTruthy();
    expect(document.activeElement).toBe(input);
    view.rerender(popup(false));
    expect(document.activeElement).toBe(launcher);
  });

  it('retains child state and DOM through accepted toggles in StrictMode', () => {
    const mount = vi.fn();
    const unmount = vi.fn();
    function Draft() {
      const [draft, setDraft] = useState('');
      useEffect(() => {
        mount();
        return unmount;
      }, []);
      return (
        <textarea
          aria-label="Draft"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      );
    }
    const popup = (open: boolean) => (
      <StrictMode>
        <ChatPopup open={open} onOpenChange={vi.fn()} title="Support">
          <Draft />
        </ChatPopup>
      </StrictMode>
    );
    const view = render(popup(true));
    const input = view.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Unsent draft' } });
    const initialMounts = mount.mock.calls.length;
    const initialUnmounts = unmount.mock.calls.length;
    view.rerender(popup(false));
    expect(view.container.querySelector('textarea')).toBe(input);
    view.rerender(popup(true));
    expect(view.getByRole('textbox')).toBe(input);
    expect(input.value).toBe('Unsent draft');
    expect(mount).toHaveBeenCalledTimes(initialMounts);
    expect(unmount).toHaveBeenCalledTimes(initialUnmounts);
  });

  it('names each non-modal dialog with stable unique IDs and honors labels and className', () => {
    const popups = (
      <>
        <ChatPopup
          open
          title="Support"
          onOpenChange={vi.fn()}
          launcherLabel="Help"
          closeLabel="Dismiss"
          className="custom"
        >
          One
        </ChatPopup>
        <ChatPopup open title="Other" onOpenChange={vi.fn()}>
          Two
        </ChatPopup>
      </>
    );
    const view = render(popups);
    const dialogs = view.getAllByRole('dialog');
    const ids = dialogs.map((panel) => panel.id);
    expect(new Set(ids).size).toBe(2);
    const headingIds = dialogs.map((panel) =>
      panel.getAttribute('aria-labelledby')
    );
    expect(new Set(headingIds).size).toBe(2);
    for (const panel of dialogs) {
      expect(panel.getAttribute('aria-modal')).toBe('false');
      expect(
        view.container.querySelector(
          `[id="${panel.getAttribute('aria-labelledby')}"]`
        )?.tagName
      ).toBe('H2');
    }
    expect(
      view.getByRole('button', { name: 'Help' }).getAttribute('aria-controls')
    ).toBe(ids[0]);
    expect(view.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    expect(view.container.querySelector('.custom')).toBeTruthy();
    view.rerender(popups);
    expect(view.getAllByRole('dialog').map((panel) => panel.id)).toEqual(ids);
  });

  it.each(['panel', 'body', 'outside'] as const)(
    'restores focus on accepted close from %s only when appropriate',
    (target) => {
      const popup = (open: boolean) => (
        <>
          <button>Outside</button>
          <ChatPopup open={open} title="Support" onOpenChange={vi.fn()}>
            <input aria-label="Message" />
          </ChatPopup>
        </>
      );
      const view = render(popup(true));
      const launcher = view.getByRole('button', { name: 'Chat' });
      const outside = view.getByRole('button', { name: 'Outside' });
      expect(document.activeElement).toBe(
        view.getByRole('button', { name: 'Close chat' })
      );
      if (target === 'outside') outside.focus();
      if (target === 'body') (document.activeElement as HTMLElement).blur();
      if (target === 'panel') view.getByRole('textbox').focus();
      view.rerender(popup(false));
      expect(document.activeElement).toBe(
        target === 'outside' ? outside : launcher
      );
    }
  );

  it('leaves external focus alone when mounted closed', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    const view = render(
      <ChatPopup open={false} title="Support" onOpenChange={vi.fn()}>
        Body
      </ChatPopup>
    );
    expect(document.activeElement).toBe(outside);
    view.unmount();
    outside.remove();
  });

  it('handles only unclaimed Escape inside the open panel and contains the handled event', () => {
    const change = vi.fn();
    const outer = vi.fn();
    const view = render(
      <div onKeyDown={outer}>
        <ChatPopup open title="Support" onOpenChange={change}>
          <input aria-label="Message" />
        </ChatPopup>
        <button>Outside</button>
      </div>
    );
    const input = view.getByRole('textbox');
    expect(fireEvent.keyDown(input, { key: 'Escape' })).toBe(false);
    expect(change).toHaveBeenCalledExactlyOnceWith(false);
    expect(outer).not.toHaveBeenCalled();
    change.mockClear();
    fireEvent.keyDown(view.getByRole('button', { name: 'Outside' }), {
      key: 'Escape',
    });
    fireEvent.keyDown(view.getByRole('button', { name: 'Chat' }), {
      key: 'Escape',
    });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(change).not.toHaveBeenCalled();
  });

  it.each([{ isComposing: true }, { keyCode: 229 }])(
    'ignores composing Escape %j',
    (composition) => {
      const change = vi.fn();
      const view = render(
        <ChatPopup open title="Support" onOpenChange={change}>
          <input aria-label="Message" />
        </ChatPopup>
      );
      expect(
        fireEvent.keyDown(view.getByRole('textbox'), {
          key: 'Escape',
          ...composition,
        })
      ).toBe(true);
      expect(change).not.toHaveBeenCalled();
    }
  );

  it('respects child Escape handling, disabled Escape and a closed panel', () => {
    const change = vi.fn();
    const popup = (open: boolean, closeOnEscape: boolean, claimed: boolean) => (
      <ChatPopup
        open={open}
        closeOnEscape={closeOnEscape}
        title="Support"
        onOpenChange={change}
      >
        <input
          aria-label="Message"
          onKeyDown={(event) => {
            if (claimed) event.preventDefault();
          }}
        />
      </ChatPopup>
    );
    const view = render(popup(true, true, true));
    fireEvent.keyDown(view.getByRole('textbox'), { key: 'Escape' });
    view.rerender(popup(true, false, false));
    expect(
      fireEvent.keyDown(view.getByRole('textbox'), { key: 'Escape' })
    ).toBe(true);
    view.rerender(popup(false, true, false));
    fireEvent.keyDown(view.getByLabelText('Message'), {
      key: 'Escape',
    });
    expect(change).not.toHaveBeenCalled();
  });

  describe('toggle shortcut', () => {
    const press = (target: EventTarget, init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true, ...init });
      target.dispatchEvent(event);
      return event;
    };
    const mount = (open: boolean, toggleShortcut?: string) => {
      const onOpenChange = vi.fn();
      const view = render(
        <>
          <input aria-label="Page search" />
          <button type="button">Page button</button>
          <ChatPopup open={open} title="Support" onOpenChange={onOpenChange} toggleShortcut={toggleShortcut}>
            <textarea aria-label="Draft" />
          </ChatPopup>
        </>
      );
      return { view, onOpenChange, launcher: view.getByRole('button', { name: 'Chat' }) };
    };

    it('is off unless a single key is given, and says nothing on the launcher', () => {
      for (const value of [undefined, '', 'kk', 'Escape']) {
        const { onOpenChange, launcher } = mount(false, value);
        expect(press(window, { key: 'k', ctrlKey: true }).defaultPrevented).toBe(false);
        expect(press(window, { key: 'Escape', ctrlKey: true }).defaultPrevented).toBe(false);
        expect(onOpenChange).not.toHaveBeenCalled();
        expect(launcher.hasAttribute('aria-keyshortcuts')).toBe(false);
        cleanup();
      }
    });

    it('requests a toggle with Ctrl or Command and the key, in either case, and claims the event', () => {
      const { onOpenChange, launcher } = mount(false, 'K');
      expect(launcher.getAttribute('aria-keyshortcuts')).toBe('Control+K Meta+K');
      expect(press(window, { key: 'k', ctrlKey: true }).defaultPrevented).toBe(true);
      expect(press(document.body, { key: 'K', metaKey: true }).defaultPrevented).toBe(true);
      expect(onOpenChange.mock.calls).toEqual([[true], [true]]);
    });

    it('requests closing when open, including from the draft inside the popup', () => {
      const { view, onOpenChange } = mount(true, 'k');
      expect(press(view.getByRole('textbox', { name: 'Draft' }), { key: 'k', metaKey: true }).defaultPrevented).toBe(true);
      expect(onOpenChange.mock.calls).toEqual([[false]]);
    });

    it('leaves the key to a field elsewhere on the page, but not to a button', () => {
      const { view, onOpenChange } = mount(false, 'k');
      expect(press(view.getByRole('textbox', { name: 'Page search' }), { key: 'k', ctrlKey: true }).defaultPrevented).toBe(false);
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(press(view.getByRole('button', { name: 'Page button' }), { key: 'k', ctrlKey: true }).defaultPrevented).toBe(true);
      expect(onOpenChange).toHaveBeenCalledTimes(1);
    });

    it('ignores other keys, missing or extra modifiers, repeats, composition and claimed events', () => {
      const { onOpenChange } = mount(false, 'k');
      for (const init of [
        { key: 'j', ctrlKey: true },
        { key: 'k' },
        { key: 'k', ctrlKey: true, shiftKey: true },
        { key: 'k', ctrlKey: true, altKey: true },
        { key: 'k', ctrlKey: true, repeat: true },
        { key: 'k', ctrlKey: true, isComposing: true },
      ] satisfies KeyboardEventInit[])
        expect(press(window, init).defaultPrevented, JSON.stringify(init)).toBe(false);
      const claim = (event: Event) => event.preventDefault();
      document.body.addEventListener('keydown', claim);
      press(document.body, { key: 'k', ctrlKey: true });
      document.body.removeEventListener('keydown', claim);
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it('uses the latest open state and handler, follows the prop, and stops listening on unmount', () => {
      const first = vi.fn();
      const second = vi.fn();
      const view = render(<ChatPopup open={false} title="Support" onOpenChange={first} toggleShortcut="k" />);
      view.rerender(<ChatPopup open title="Support" onOpenChange={second} toggleShortcut="k" />);
      press(window, { key: 'k', ctrlKey: true });
      expect(first).not.toHaveBeenCalled();
      expect(second.mock.calls).toEqual([[false]]);
      view.rerender(<ChatPopup open title="Support" onOpenChange={second} toggleShortcut="j" />);
      press(window, { key: 'k', ctrlKey: true });
      press(window, { key: 'j', ctrlKey: true });
      expect(second).toHaveBeenCalledTimes(2);
      view.rerender(<ChatPopup open title="Support" onOpenChange={second} />);
      press(window, { key: 'j', ctrlKey: true });
      view.unmount();
      expect(press(window, { key: 'j', ctrlKey: true }).defaultPrevented).toBe(false);
      expect(second).toHaveBeenCalledTimes(2);
    });

    it('works through ChatSidebar and leaves the key to fields in the page content', () => {
      const onOpenChange = vi.fn();
      const view = render(
        <ChatSidebar open={false} title="Support" onOpenChange={onOpenChange} toggleShortcut="k" pageContent={<input aria-label="Page field" />}>
          <textarea aria-label="Draft" />
        </ChatSidebar>
      );
      press(view.getByRole('textbox', { name: 'Page field' }), { key: 'k', ctrlKey: true });
      expect(onOpenChange).not.toHaveBeenCalled();
      press(window, { key: 'k', ctrlKey: true });
      expect(onOpenChange.mock.calls).toEqual([[true]]);
    });

    it('requests once per press under StrictMode', () => {
      const onOpenChange = vi.fn();
      render(
        <StrictMode>
          <ChatPopup open={false} title="Support" onOpenChange={onOpenChange} toggleShortcut="k" />
        </StrictMode>
      );
      press(window, { key: 'k', ctrlKey: true });
      expect(onOpenChange).toHaveBeenCalledTimes(1);
    });
  });
});
