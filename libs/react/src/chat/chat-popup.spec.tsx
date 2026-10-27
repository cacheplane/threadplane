import { StrictMode, useEffect, useState } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPopup } from './index';

afterEach(cleanup);

describe('ChatPopup', () => {
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
});
