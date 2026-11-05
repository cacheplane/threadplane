import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CitationPreview, Citations } from './index';

const citation = Object.freeze({
  id: 'a',
  index: 7,
  title: '<b>Evidence</b>',
  snippet: '<img src=x>\nLiteral',
  sourceType: '',
  publishedAt: 'not a date',
  url: 'https://example.com/raw',
  iconUrl: 'https://images.invalid/icon',
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
function open(view: ReturnType<typeof render>) {
  const trigger = view.getByRole('button', { name: /^Preview source/ });
  trigger.focus();
  fireEvent.click(trigger);
  return { trigger, dialog: view.getByRole('dialog') };
}
describe('CitationPreview', () => {
  it('contains trigger keyboard events while preserving ordinary activation and Tab defaults', () => {
    const outer = vi.fn();
    const view = render(
      <div onKeyDown={outer} onKeyUp={outer}>
        <CitationPreview citation={citation} />
      </div>
    );
    const trigger = view.getByRole('button');
    for (const key of ['Enter', ' ', 'Tab', 'k']) {
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
      fireEvent(trigger, down);
      fireEvent(trigger, up);
      expect(down.defaultPrevented).toBe(false);
      expect(up.defaultPrevented).toBe(false);
    }
    expect(outer).not.toHaveBeenCalled();
    expect(view.queryByRole('dialog')).toBeNull();
    // jsdom does not implement native keyboard button activation.
    fireEvent.click(trigger);
    expect(view.getByRole('dialog')).toBeTruthy();
  });
  it.each([
    { repeat: true },
    { isComposing: true },
    { keyCode: 229 },
    { claimed: true },
  ])(
    'suppresses ignored trigger activation and its later Space release: %j',
    (extra) => {
      const view = render(<CitationPreview citation={citation} />);
      const trigger = view.getByRole('button');
      for (const key of ['Enter', ' ']) {
        const down = new KeyboardEvent('keydown', {
          key,
          bubbles: true,
          cancelable: true,
          ...extra,
        });
        if ('claimed' in extra) down.preventDefault();
        fireEvent(trigger, down);
        expect(down.defaultPrevented).toBe(true);
        const up = new KeyboardEvent('keyup', {
          key,
          bubbles: true,
          cancelable: true,
        });
        fireEvent(trigger, up);
        if (key === ' ') expect(up.defaultPrevented).toBe(true);
      }
      expect(view.queryByRole('dialog')).toBeNull();
    }
  );
  it('suppresses a Space release after trigger focus ownership is lost', () => {
    const view = render(<CitationPreview citation={citation} />);
    const trigger = view.getByRole('button');
    fireEvent.keyDown(trigger, { key: ' ' });
    fireEvent.blur(trigger);
    const up = new KeyboardEvent('keyup', {
      key: ' ',
      bubbles: true,
      cancelable: true,
    });
    fireEvent(trigger, up);
    expect(up.defaultPrevented).toBe(true);
  });
  it('renders an inert server button and opens only on explicit activation with literal supplied metadata', () => {
    expect(
      renderToString(<CitationPreview citation={citation} />)
    ).not.toContain('<dialog');
    const view = render(
      <CitationPreview citation={citation} className="extra" />
    );
    const trigger = view.getByRole('button', {
      name: 'Preview source 7: <b>Evidence</b>',
    });
    fireEvent.mouseOver(trigger);
    trigger.focus();
    expect(view.queryByRole('dialog')).toBeNull();
    const { dialog } = open(view);
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.getAttribute('aria-label')).toBe('Source 7');
    expect(dialog.textContent).toContain('<b>Evidence</b>');
    expect(dialog.textContent).toContain('<img src=x>\nLiteral');
    expect(dialog.textContent).toContain('not a date');
    expect(
      dialog.querySelector('dd[data-field="sourceType"]')?.textContent
    ).toBe('');
    expect(dialog.querySelector('img, script, b')).toBeNull();
    expect(trigger.className).toContain('extra');
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(
      view.getByRole('button', { name: 'Close' })
    );
    const link = within(dialog).getByRole('link', { name: 'Open source' });
    expect(link.getAttribute('href')).toBe(citation.url);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    fireEvent.click(view.getByRole('button', { name: 'Close' }));
    expect(view.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it.each([
    'javascript:alert(1)',
    'data:text/html,bad',
    'java\nscript:bad',
    '',
    undefined,
  ])('keeps blocked or absent destination %j as literal metadata', (url) => {
    const view = render(
      <CitationPreview
        citation={{
          id: 'a',
          index: 1,
          url,
          title: '',
          snippet: '',
          publishedAt: '',
        }}
      />
    );
    const { dialog } = open(view);
    expect(within(dialog).queryByRole('link')).toBeNull();
    expect(dialog.querySelector('dd[data-field="url"]')?.textContent).toBe(
      url ?? undefined
    );
    expect(
      dialog.querySelector('dd[data-field="publishedAt"]')?.textContent
    ).toBe('');
    expect(dialog.querySelector('h2')?.textContent).toBe('');
  });
  it('uses URL then source label for missing titles', () => {
    const view = render(
      <CitationPreview citation={{ id: 'a', index: 1, url: '/raw' }} />
    );
    expect(
      view.getByRole('button', { name: 'Preview source 1: /raw' })
    ).toBeTruthy();
    view.rerender(<CitationPreview citation={{ id: 'a', index: 2 }} />);
    expect(
      view.getByRole('button', { name: 'Preview source 2: Source 2' })
    ).toBeTruthy();
  });
  it('preserves modal and focus across metadata updates and keyed reorder, retires removal and A/B/A identities', () => {
    const view = render(
      <Citations preview citations={[citation, { id: 'b', index: 2 }]} />
    );
    const trigger = view.getByRole('button', {
      name: 'Preview source 7: <b>Evidence</b>',
    });
    fireEvent.click(trigger);
    const dialog = view.getByRole('dialog');
    const close = view.getByRole('button', { name: 'Close' });
    view.rerender(
      <Citations
        preview
        citations={[
          { id: 'b', index: 2 },
          { ...citation, title: 'Updated', snippet: '' },
        ]}
      />
    );
    expect(view.getByRole('dialog')).toBe(dialog);
    expect(dialog.textContent).toContain('Updated');
    expect(document.activeElement).toBe(close);
    view.rerender(<Citations preview citations={[{ id: 'b', index: 2 }]} />);
    expect(view.queryByRole('dialog')).toBeNull();
    view.rerender(<CitationPreview citation={citation} />);
    open(view);
    view.rerender(<CitationPreview citation={{ id: 'b', index: 2 }} />);
    expect(view.queryByRole('dialog')).toBeNull();
    view.rerender(<CitationPreview citation={citation} />);
    expect(view.queryByRole('dialog')).toBeNull();
  });
  it('contains native Tab boundaries including the anchor without intercepting interior sequencing or claimed keys', () => {
    const view = render(<CitationPreview citation={citation} />);
    const { dialog } = open(view);
    const close = view.getByRole('button', { name: 'Close' });
    const link = view.getByRole('link', { name: 'Open source' });
    const key = (target: HTMLElement, shiftKey = false, claimed = false) => {
      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      if (claimed) event.preventDefault();
      fireEvent(target, event);
      return event;
    };
    expect(key(close).defaultPrevented).toBe(false);
    key(close, true);
    expect(document.activeElement).toBe(link);
    key(link);
    expect(document.activeElement).toBe(close);
    key(close, true, true);
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    view.rerender(<CitationPreview citation={{ id: 'b', index: 2 }} />);
    open(view);
    const only = view.getByRole('button', { name: 'Close' });
    expect(key(only).defaultPrevented).toBe(true);
    expect(key(only, true).defaultPrevented).toBe(true);
    expect(dialog.isConnected).toBe(false);
  });
  it('owns keyboard and pointer bubbling, ignores composing/repeating/claimed Escape and closes for Escape or native cancel', () => {
    const outer = vi.fn();
    const view = render(
      <div onKeyDown={outer} onKeyUp={outer} onClick={outer}>
        <CitationPreview citation={citation} />
      </div>
    );
    let { dialog } = open(view);
    outer.mockClear();
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
    expect(view.getByRole('dialog')).toBe(dialog);
    fireEvent.keyDown(dialog, { key: 'k' });
    fireEvent.keyUp(dialog, { key: 'k' });
    fireEvent.click(within(dialog).getByRole('heading'));
    expect(outer).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(view.queryByRole('dialog')).toBeNull();
    ({ dialog } = open(view));
    const cancel = new Event('cancel', { cancelable: true });
    cancel.preventDefault();
    fireEvent(dialog, cancel);
    expect(view.getByRole('dialog')).toBe(dialog);
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(view.queryByRole('dialog')).toBeNull();
  });
  it('dismisses only unclaimed unmodified outside-bounds clicks and respects claimed Close', () => {
    const view = render(<CitationPreview citation={citation} />);
    const { dialog } = open(view);
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
      left: 20,
      top: 20,
      right: 200,
      bottom: 200,
    } as DOMRect);
    fireEvent.click(dialog, { clientX: 25, clientY: 25 });
    fireEvent.click(within(dialog).getByRole('heading'), {
      clientX: 0,
      clientY: 0,
    });
    fireEvent.click(dialog, { clientX: 0, clientY: 0, ctrlKey: true });
    const claimed = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: 0,
      clientY: 0,
    });
    claimed.preventDefault();
    fireEvent(dialog, claimed);
    const close = new MouseEvent('click', { bubbles: true, cancelable: true });
    close.preventDefault();
    fireEvent(view.getByRole('button', { name: 'Close' }), close);
    expect(view.getByRole('dialog')).toBe(dialog);
    fireEvent.click(dialog, { clientX: 0, clientY: 0 });
    expect(view.queryByRole('dialog')).toBeNull();
  });
  it('does not steal moved focus or restore hidden, disabled and disconnected triggers', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    const view = render(<CitationPreview citation={citation} />);
    let { trigger } = open(view);
    outside.focus();
    view.rerender(<CitationPreview citation={{ id: 'b', index: 2 }} />);
    expect(document.activeElement).toBe(outside);
    for (const mode of ['hidden', 'disabled', 'disconnected']) {
      ({ trigger } = open(view));
      if (mode === 'hidden') trigger.hidden = true;
      else if (mode === 'disabled')
        (trigger as HTMLButtonElement).disabled = true;
      view.rerender(<CitationPreview citation={{ id: mode, index: 2 }} />);
      expect(document.activeElement).not.toBe(trigger);
    }
    outside.remove();
  });
  it('cleans native modal listeners in StrictMode and uses the trigger owner document and inherited theme', () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const doc = frame.contentDocument;
    if (!doc) throw new Error('Expected frame document');
    const foreignPrototype = Object.getPrototypeOf(doc.createElement('dialog'));
    Object.defineProperty(foreignPrototype, 'showModal', {
      configurable: true,
      value: HTMLDialogElement.prototype.showModal,
    });
    Object.defineProperty(foreignPrototype, 'close', {
      configurable: true,
      value: HTMLDialogElement.prototype.close,
    });
    const host = doc.createElement('div');
    doc.body.append(host);
    const view = render(
      <StrictMode>
        <div
          dir="rtl"
          style={
            {
              fontFamily: 'monospace',
              '--tp-chat-accent': 'purple',
            } as React.CSSProperties
          }
        >
          <CitationPreview citation={citation} />
        </div>
      </StrictMode>,
      { container: host, baseElement: doc.body }
    );
    const { dialog } = open(view);
    expect(dialog.ownerDocument).toBe(doc);
    expect(dialog.parentElement).toBe(doc.body);
    expect(dialog.getAttribute('dir')).toBe('rtl');
    expect(dialog.style.fontFamily).toBe('monospace');
    expect(dialog.style.getPropertyValue('--tp-chat-accent')).toBe('purple');
    expect(document.querySelector('dialog')).toBeNull();
    view.unmount();
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(dialog.isConnected).toBe(false);
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
    frame.remove();
  });
});
