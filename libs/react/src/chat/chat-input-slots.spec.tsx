import { StrictMode, useState } from 'react';
import { renderToString } from 'react-dom/server';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatInput } from './index';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const box = (view: ReturnType<typeof render>) =>
  view.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
const type = (el: HTMLTextAreaElement, value: string) =>
  fireEvent.change(el, { target: { value } });
const classes = (parent: Element | null) =>
  Array.from(parent?.children ?? []).map((child) => child.className);

describe('ChatInput slots', () => {
  it('adds no slot elements when no slot content is supplied', () => {
    const view = render(
      <ChatInput
        onSubmit={() => undefined}
        leading={null}
        trailing={false}
        footer={undefined}
      />
    );
    const form = view.container.querySelector('form');
    expect(classes(form)).toEqual([
      'tp-chat-input__label',
      'tp-chat-input__pill',
    ]);
    expect(classes(form?.querySelector('.tp-chat-input__pill') ?? null)).toEqual(
      ['tp-chat-input__textarea', 'tp-chat-input__actions']
    );
    expect(
      classes(form?.querySelector('.tp-chat-input__actions') ?? null)
    ).toEqual(['tp-chat-input__send']);
  });

  it('places leading before the draft, trailing before Stop and Send, and footer after the hint', () => {
    const view = render(
      <ChatInput
        onSubmit={() => undefined}
        onStop={() => undefined}
        busy
        hint="Enter sends"
        leading={<span>Lead</span>}
        trailing={<button type="button">Tools</button>}
        footer={<p role="status">Saved</p>}
      />
    );
    const form = view.container.querySelector('form');
    expect(classes(form)).toEqual([
      'tp-chat-input__label',
      'tp-chat-input__pill',
      'tp-chat-input__hint',
      'tp-chat-input__footer',
    ]);
    expect(classes(form?.querySelector('.tp-chat-input__pill') ?? null)).toEqual(
      [
        'tp-chat-input__leading',
        'tp-chat-input__textarea',
        'tp-chat-input__actions',
      ]
    );
    expect(
      classes(form?.querySelector('.tp-chat-input__actions') ?? null)
    ).toEqual([
      'tp-chat-input__trailing',
      'tp-chat-input__stop',
      'tp-chat-input__send',
    ]);
    expect(view.getByText('Lead').parentElement?.className).toBe(
      'tp-chat-input__leading'
    );
    expect(view.getByRole('status').textContent).toBe('Saved');
    // Tab order follows the visual order.
    expect(
      Array.from(form?.querySelectorAll('textarea, button') ?? []).map(
        (el) => el.textContent || el.tagName
      )
    ).toEqual(['TEXTAREA', 'Tools', 'Stop', 'Send']);
  });

  it('leaves the draft, its name and its description to the built-in parts', () => {
    const view = render(
      <ChatInput
        onSubmit={() => undefined}
        hint="Enter sends"
        leading={<span>Lead</span>}
        footer={<p>Footer text</p>}
      />
    );
    const input = box(view);
    const described = input.getAttribute('aria-describedby') ?? '';
    expect(view.container.ownerDocument.getElementById(described)?.textContent).toBe(
      'Enter sends'
    );
  });

  it('never sends, clears or steals focus when a slot button is pressed', () => {
    const onSubmit = vi.fn();
    const pressed = vi.fn();
    const view = render(
      <ChatInput
        onSubmit={onSubmit}
        defaultValue="Draft"
        trailing={
          <button type="button" onClick={pressed}>
            Tools
          </button>
        }
      />
    );
    const tools = view.getByRole('button', { name: 'Tools' });
    tools.focus();
    fireEvent.click(tools);
    expect(pressed).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(box(view).value).toBe('Draft');
    expect(document.activeElement).toBe(tools);
  });

  it('keeps slot content enabled and mounted while the composer is disabled or busy', () => {
    const pressed = vi.fn();
    const slot = (
      <button type="button" onClick={pressed}>
        Tools
      </button>
    );
    const view = render(
      <ChatInput onSubmit={() => undefined} disabled trailing={slot} />
    );
    const tools = view.getByRole('button', { name: 'Tools' });
    expect((tools as HTMLButtonElement).disabled).toBe(false);
    view.rerender(
      <ChatInput
        onSubmit={() => undefined}
        busy
        onStop={() => undefined}
        trailing={slot}
      />
    );
    expect(view.getByRole('button', { name: 'Tools' })).toBe(tools);
    fireEvent.click(tools);
    expect(pressed).toHaveBeenCalledOnce();
  });

  it('keeps slot state across drafts, submission and the Stop and Send swap', () => {
    function Counter() {
      const [count, setCount] = useState(0);
      return (
        <button type="button" onClick={() => setCount(count + 1)}>
          Count {count}
        </button>
      );
    }
    function Owner({ busy }: { busy: boolean }) {
      return (
        <ChatInput
          onSubmit={() => undefined}
          onStop={() => undefined}
          busy={busy}
          leading={<Counter />}
        />
      );
    }
    const view = render(<Owner busy={false} />);
    fireEvent.click(view.getByRole('button', { name: 'Count 0' }));
    type(box(view), 'Hello');
    fireEvent.submit(box(view).closest('form') as HTMLFormElement);
    expect(box(view).value).toBe('');
    view.rerender(<Owner busy />);
    view.rerender(<Owner busy={false} />);
    expect(view.getByRole('button', { name: 'Count 1' })).toBeTruthy();
  });

  it('treats an app-owned submit button as Send without taking its focus', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const onSubmit = vi.fn();
    const view = render(
      <ChatInput
        onSubmit={onSubmit}
        defaultValue="Draft"
        leading={<button type="submit">Send now</button>}
      />
    );
    const own = view.getByRole('button', { name: 'Send now' });
    own.focus();
    fireEvent.submit(own.closest('form') as HTMLFormElement);
    expect(onSubmit.mock.calls).toEqual([['Draft']]);
    expect(box(view).value).toBe('');
    for (const frame of frames) frame(0);
    // The composer restores focus only from its own Send.
    expect(document.activeElement).toBe(own);
  });

  it('still returns focus to the draft from the built-in Send when a slot holds a submit button', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const view = render(
      <ChatInput
        onSubmit={() => undefined}
        defaultValue="Draft"
        leading={<button type="submit">Send now</button>}
      />
    );
    const send = view.getByRole('button', { name: 'Send' });
    send.focus();
    fireEvent.click(send);
    for (const frame of frames) frame(0);
    expect(document.activeElement).toBe(box(view));
  });

  it('renders slots once under StrictMode and on the server', () => {
    const tree = (
      <ChatInput
        onSubmit={() => undefined}
        leading={<span>Lead</span>}
        trailing={<span>Trail</span>}
        footer={<span>Foot</span>}
      />
    );
    const view = render(<StrictMode>{tree}</StrictMode>);
    for (const name of ['leading', 'trailing', 'footer']) {
      expect(
        view.container.querySelectorAll(`.tp-chat-input__${name}`)
      ).toHaveLength(1);
    }
    const html = renderToString(tree);
    expect(html.indexOf('Lead')).toBeLessThan(html.indexOf('<textarea'));
    expect(html.indexOf('Trail')).toBeGreaterThan(html.indexOf('<textarea'));
    expect(html.indexOf('Foot')).toBeGreaterThan(html.indexOf('Trail'));
  });
});
