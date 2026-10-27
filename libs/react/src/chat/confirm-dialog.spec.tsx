import { cleanup, fireEvent, render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './index';

const props = () => ({
  open: true,
  title: 'Delete conversation?',
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
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

describe('ConfirmDialog', () => {
  it('exports a public primitive', () => {
    expect(typeof ConfirmDialog).toBe('function');
  });
  it('server rendering is a hidden marker without an open modal', () => {
    const html = renderToString(<ConfirmDialog {...props()} />);
    expect(html).toContain('hidden');
    expect(html).not.toContain('<dialog');
  });
  it('opens a native labelled modal in the owner body with Cancel default focus', () => {
    const view = render(
      <ConfirmDialog {...props()} body="Permanent deletion" />
    );
    const dialog = view.getByRole('alertdialog', {
      name: 'Delete conversation?',
    });
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(
      document.getElementById(dialog.getAttribute('aria-describedby') ?? '')
        ?.textContent
    ).toBe('Permanent deletion');
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(
      view.getByRole('button', { name: 'Cancel' })
    );
  });
  it('keeps modal, buttons and focus stable across callback, title and pending updates', () => {
    const p = props();
    const view = render(<ConfirmDialog {...p} />);
    const dialog = view.getByRole('alertdialog');
    const confirm = view.getByRole('button', { name: 'Confirm' });
    const cancel = view.getByRole('button', { name: 'Cancel' });
    const newer = vi.fn();
    view.rerender(
      <ConfirmDialog {...p} title="New title" pending onCancel={newer} />
    );
    expect(view.getByRole('alertdialog')).toBe(dialog);
    expect(view.getByRole('button', { name: 'Confirm' })).toBe(confirm);
    expect(document.activeElement).toBe(cancel);
    expect(confirm).toHaveProperty('disabled', true);
    expect(cancel).toHaveProperty('disabled', false);
    expect(dialog.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(confirm);
    fireEvent.click(cancel);
    expect(p.onConfirm).not.toHaveBeenCalled();
    expect(newer).toHaveBeenCalledOnce();
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();
  });
  it('delegates explicit confirm synchronously and preserves controlled open', () => {
    const p = props();
    const view = render(
      <ConfirmDialog
        {...p}
        confirmLabel="Delete"
        cancelLabel="Keep"
        tone="destructive"
        className="custom"
      />
    );
    fireEvent.click(view.getByRole('button', { name: 'Delete' }));
    expect(p.onConfirm).toHaveBeenCalledOnce();
    expect(view.getByRole('alertdialog').classList.contains('custom')).toBe(
      true
    );
    expect(view.getByRole('alertdialog').hasAttribute('open')).toBe(true);
  });
  it('contains reverse and forward Tab at the enabled button boundaries', () => {
    const view = render(<ConfirmDialog {...props()} />);
    const cancel = view.getByRole('button', { name: 'Cancel' });
    const confirm = view.getByRole('button', { name: 'Confirm' });
    expect(document.activeElement).toBe(cancel);
    const reverse = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(cancel, reverse);
    expect(reverse.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(confirm);
    const forward = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    fireEvent(confirm, forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);
  });

  it('contains both Tab directions on Cancel while Confirm is pending', () => {
    const view = render(<ConfirmDialog {...props()} pending />);
    const cancel = view.getByRole('button', { name: 'Cancel' });
    for (const shiftKey of [false, true]) {
      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      fireEvent(cancel, event);
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(cancel);
    }
  });

  it('preserves native interior Tab sequencing', () => {
    const view = render(<ConfirmDialog {...props()} />);
    const cancel = view.getByRole('button', { name: 'Cancel' });
    const confirm = view.getByRole('button', { name: 'Confirm' });
    const forward = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    fireEvent(cancel, forward);
    expect(forward.defaultPrevented).toBe(false);
    confirm.focus();
    const reverse = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(confirm, reverse);
    expect(reverse.defaultPrevented).toBe(false);
  });

  it('does not move focus for claimed boundary Tab', () => {
    const p = props();
    const view = render(<ConfirmDialog {...p} />);
    const cancel = view.getByRole('button', { name: 'Cancel' });
    const claimed = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    claimed.preventDefault();
    fireEvent(cancel, claimed);
    expect(document.activeElement).toBe(cancel);
    expect(p.onCancel).not.toHaveBeenCalled();
    expect(p.onConfirm).not.toHaveBeenCalled();
  });

  it('Escape requests Cancel once without native closure or enclosing shortcuts', () => {
    const outer = vi.fn();
    const p = props();
    const view = render(
      <div onKeyDown={outer}>
        <ConfirmDialog {...p} />
      </div>
    );
    const dialog = view.getByRole('alertdialog');
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    fireEvent(dialog, event);
    expect(event.defaultPrevented).toBe(true);
    expect(p.onCancel).toHaveBeenCalledOnce();
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(outer).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: 'k' });
    expect(outer).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    'accepts a fresh Escape after a lost release (window blurred: %j)',
    (blurWindow) => {
      const p = props();
      const view = render(<ConfirmDialog {...p} />);
      const dialog = view.getByRole('alertdialog');
      fireEvent.keyDown(dialog, { key: 'Escape', repeat: false });
      const firstCancel = new Event('cancel', { cancelable: true });
      fireEvent(dialog, firstCancel);
      expect(firstCancel.defaultPrevented).toBe(true);
      expect(p.onCancel).toHaveBeenCalledOnce();
      fireEvent.keyDown(dialog, { key: 'Escape', repeat: true });
      expect(p.onCancel).toHaveBeenCalledOnce();
      if (blurWindow) fireEvent(window, new Event('blur'));
      // The caller refused Cancel; the first release never reached this panel.
      fireEvent.keyDown(dialog, { key: 'Escape', repeat: false });
      const secondCancel = new Event('cancel', { cancelable: true });
      fireEvent(dialog, secondCancel);
      expect(secondCancel.defaultPrevented).toBe(true);
      expect(p.onCancel).toHaveBeenCalledTimes(2);
      expect(dialog.hasAttribute('open')).toBe(true);
    }
  );

  it.each(['blur', 'hidden'])(
    'accepts a new native cancel after keyboard ownership is lost to %s',
    (boundary) => {
      const p = props();
      const view = render(<ConfirmDialog {...p} />);
      const dialog = view.getByRole('alertdialog');
      fireEvent.keyDown(dialog, { key: 'Escape' });
      expect(p.onCancel).toHaveBeenCalledOnce();
      if (boundary === 'blur') fireEvent(window, new Event('blur'));
      else {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        fireEvent(document, new Event('visibilitychange'));
      }
      const event = new Event('cancel', { cancelable: true });
      fireEvent(dialog, event);
      expect(event.defaultPrevented).toBe(true);
      expect(p.onCancel).toHaveBeenCalledTimes(2);
      expect(dialog.hasAttribute('open')).toBe(true);
    }
  );

  it('does not admit a Space release from a press before window blur', () => {
    const view = render(<ConfirmDialog {...props()} />);
    const button = view.getByRole('button', { name: 'Confirm' });
    fireEvent.keyDown(button, { key: ' ' });
    fireEvent(window, new Event('blur'));
    const release = new KeyboardEvent('keyup', {
      key: ' ',
      bubbles: true,
      cancelable: true,
    });
    fireEvent(button, release);
    expect(release.defaultPrevented).toBe(true);
    const nextDown = new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true,
    });
    const nextUp = new KeyboardEvent('keyup', {
      key: ' ',
      bubbles: true,
      cancelable: true,
    });
    fireEvent(button, nextDown);
    fireEvent(button, nextUp);
    expect(nextDown.defaultPrevented).toBe(false);
    expect(nextUp.defaultPrevented).toBe(false);
  });

  it('ignores claimed, repeating and composing Escape commands', () => {
    const p = props();
    const view = render(<ConfirmDialog {...p} />);
    const dialog = view.getByRole('alertdialog');
    for (const extra of [
      { repeat: true },
      { isComposing: true },
      { keyCode: 229 },
    ])
      fireEvent.keyDown(dialog, { key: 'Escape', ...extra });
    const claimed = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    claimed.preventDefault();
    fireEvent(dialog, claimed);
    expect(p.onCancel).not.toHaveBeenCalled();
  });
  it.each([
    { isComposing: true },
    { keyCode: 229 },
    { repeat: true },
    { claimed: true },
  ])(
    'prevents ignored Space press and its later ordinary release: %j',
    (extra) => {
      const p = props();
      const view = render(<ConfirmDialog {...p} />);
      for (const name of ['Confirm', 'Cancel']) {
        const button = view.getByRole('button', { name });
        const down = new KeyboardEvent('keydown', {
          key: ' ',
          bubbles: true,
          cancelable: true,
          ...extra,
        });
        if ('claimed' in extra) down.preventDefault();
        fireEvent(button, down);
        expect(down.defaultPrevented).toBe(true);
        const up = new KeyboardEvent('keyup', {
          key: ' ',
          bubbles: true,
          cancelable: true,
        });
        fireEvent(button, up);
        expect(up.defaultPrevented).toBe(true);
      }
      expect(p.onConfirm).not.toHaveBeenCalled();
      expect(p.onCancel).not.toHaveBeenCalled();
    }
  );

  it.each([{ isComposing: true }, { keyCode: 229 }, { claimed: true }])(
    'prevents Space release crossing an ignored boundary: %j',
    (extra) => {
      const p = props();
      const view = render(<ConfirmDialog {...p} />);
      const button = view.getByRole('button', { name: 'Confirm' });
      const down = new KeyboardEvent('keydown', {
        key: ' ',
        bubbles: true,
        cancelable: true,
      });
      fireEvent(button, down);
      expect(down.defaultPrevented).toBe(false);
      const up = new KeyboardEvent('keyup', {
        key: ' ',
        bubbles: true,
        cancelable: true,
        ...extra,
      });
      if ('claimed' in extra) up.preventDefault();
      fireEvent(button, up);
      expect(up.defaultPrevented).toBe(true);
      expect(p.onConfirm).not.toHaveBeenCalled();
    }
  );

  it.each(['Enter', ' '])(
    'leaves ordinary native %j activation available without a second callback',
    (key) => {
      const p = props();
      const view = render(<ConfirmDialog {...p} />);
      const button = view.getByRole('button', { name: 'Confirm' });
      const down = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      });
      const up = new KeyboardEvent('keyup', {
        key,
        bubbles: true,
        cancelable: true,
      });
      fireEvent(button, down);
      fireEvent(button, up);
      expect(down.defaultPrevented).toBe(false);
      expect(up.defaultPrevented).toBe(false);
      // jsdom has no keyboard activation defaults; the browser proof owns that step.
      expect(p.onConfirm).not.toHaveBeenCalled();
      fireEvent.click(button);
      expect(p.onConfirm).toHaveBeenCalledOnce();
    }
  );

  it('native cancel remains controlled and prevents closure', () => {
    const p = props();
    const view = render(<ConfirmDialog {...p} />);
    const dialog = view.getByRole('alertdialog');
    const event = new Event('cancel', { cancelable: true });
    fireEvent(dialog, event);
    expect(event.defaultPrevented).toBe(true);
    expect(p.onCancel).toHaveBeenCalledOnce();
    expect(dialog.hasAttribute('open')).toBe(true);
  });
  it('dismisses only backdrop coordinates outside dialog bounds', () => {
    const p = props();
    const view = render(<ConfirmDialog {...p} body="Content" />);
    const dialog = view.getByRole('alertdialog');
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
      left: 20,
      top: 20,
      right: 200,
      bottom: 200,
    } as DOMRect);
    fireEvent.click(dialog, { clientX: 25, clientY: 25 });
    fireEvent.click(view.getByText('Content'), { clientX: 0, clientY: 0 });
    expect(p.onCancel).not.toHaveBeenCalled();
    fireEvent.click(dialog, { clientX: 0, clientY: 0 });
    expect(p.onCancel).toHaveBeenCalledOnce();
  });
  it('restores the original available invoker on close and unmount', () => {
    const invoker = document.createElement('button');
    document.body.append(invoker);
    invoker.focus();
    const replacement = document.createElement('button');
    document.body.append(replacement);
    const p = props();
    const view = render(<ConfirmDialog {...p} returnFocusTo={invoker} />);
    view.rerender(
      <ConfirmDialog {...p} open={false} returnFocusTo={replacement} />
    );
    expect(document.activeElement).toBe(invoker);
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalledOnce();
    invoker.focus();
    view.rerender(<ConfirmDialog {...p} returnFocusTo={invoker} />);
    view.unmount();
    expect(document.activeElement).toBe(invoker);
    invoker.remove();
    replacement.remove();
  });
  it('does not steal deliberately moved focus or restore hidden/disconnected targets', () => {
    const invoker = document.createElement('button');
    const outside = document.createElement('button');
    document.body.append(invoker, outside);
    invoker.focus();
    const p = props();
    const view = render(<ConfirmDialog {...p} />);
    outside.focus();
    view.rerender(<ConfirmDialog {...p} open={false} />);
    expect(document.activeElement).toBe(outside);
    invoker.focus();
    view.rerender(<ConfirmDialog {...p} />);
    invoker.hidden = true;
    view.unmount();
    expect(document.activeElement).not.toBe(invoker);
    invoker.remove();
    outside.remove();
  });
  it('copies local theme, font and RTL to a stable portal and rejects a foreign return target', () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const foreignDocument = frame.contentDocument;
    if (!foreignDocument) throw new Error('Expected iframe document');
    const foreign = foreignDocument.createElement('button');
    foreignDocument.body.append(foreign);
    const view = render(
      <div
        dir="rtl"
        style={
          {
            fontFamily: 'monospace',
            '--tp-chat-danger': 'purple',
          } as React.CSSProperties
        }
      >
        <ConfirmDialog {...props()} returnFocusTo={foreign} />
      </div>
    );
    const dialog = view.getByRole('alertdialog');
    expect(dialog.getAttribute('dir')).toBe('rtl');
    expect(dialog.style.fontFamily).toBe('monospace');
    expect(dialog.style.getPropertyValue('--tp-chat-danger')).toBe('purple');
    view.unmount();
    expect(foreignDocument.activeElement).not.toBe(foreign);
    frame.remove();
  });
});
