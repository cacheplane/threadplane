import { renderToString } from 'react-dom/server';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as chat from './index';

const { LauncherButton, ChatWindow } = chat;

afterEach(cleanup);

describe('LauncherButton', () => {
  it('is a named native button with a decorative icon and no state attributes by default', () => {
    const view = render(<LauncherButton onClick={vi.fn()} />);
    const button = view.getByRole('button', { name: 'Open chat' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.className).toBe('tp-launcher-button');
    expect(button.hasAttribute('aria-expanded')).toBe(false);
    expect(button.hasAttribute('aria-controls')).toBe(false);
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(button.textContent).toBe('');
  });

  it('requests once per press with no arguments', () => {
    const onClick = vi.fn();
    const view = render(<LauncherButton onClick={onClick} />);
    fireEvent.click(view.getByRole('button'));
    expect(onClick.mock.calls).toEqual([[]]);
  });

  it('takes a label, the open state, the controlled id and a class', () => {
    const view = render(<LauncherButton onClick={vi.fn()} label="Ask <b>Rail</b> desk" expanded={false} controls="panel" className="mine" />);
    const button = view.getByRole('button', { name: 'Ask <b>Rail</b> desk' });
    expect(button.className).toBe('tp-launcher-button mine');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe('panel');
    view.rerender(<LauncherButton onClick={vi.fn()} expanded controls="panel" />);
    expect(view.getByRole('button', { name: 'Open chat' })).toBe(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('calls the handler of the latest render', () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = render(<LauncherButton onClick={first} />);
    view.rerender(<LauncherButton onClick={second} />);
    fireEvent.click(view.getByRole('button'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('server renders without browser globals', () => {
    expect(renderToString(<LauncherButton onClick={() => undefined} />)).toContain('<button type="button" class="tp-launcher-button" aria-label="Open chat">');
  });
});

describe('ChatWindow', () => {
  it('renders header, body and footer in order, with a decorative fade in the footer', () => {
    const view = render(
      <ChatWindow header={<h2>Trip</h2>} footer={<textarea aria-label="Message" />} className="mine">
        <p>Messages</p>
      </ChatWindow>
    );
    const root = view.container.firstElementChild as HTMLElement;
    expect(root.className).toBe('tp-chat-window mine');
    expect([...root.children].map((node) => node.className)).toEqual(['tp-chat-window__header', 'tp-chat-window__body', 'tp-chat-window__footer']);
    expect(root.children[0].textContent).toBe('Trip');
    expect(root.children[1].textContent).toBe('Messages');
    const fade = root.children[2].firstElementChild as HTMLElement;
    expect(fade.className).toBe('tp-chat-window__fade');
    expect(fade.getAttribute('aria-hidden')).toBe('true');
    expect(view.getByRole('textbox', { name: 'Message' }).parentElement).toBe(root.children[2]);
  });

  it('leaves out the header and footer regions that were not supplied', () => {
    const view = render(<ChatWindow>Body</ChatWindow>);
    const root = view.container.firstElementChild as HTMLElement;
    expect([...root.children].map((node) => node.className)).toEqual(['tp-chat-window__body']);
    view.rerender(<ChatWindow header={null}>Body</ChatWindow>);
    expect(root.children).toHaveLength(2);
  });

  it('keeps the body mounted when the header and footer come and go', () => {
    const view = render(
      <ChatWindow>
        <input aria-label="Kept" />
      </ChatWindow>
    );
    const input = view.getByRole('textbox', { name: 'Kept' });
    view.rerender(
      <ChatWindow header="Trip" footer="Send">
        <input aria-label="Kept" />
      </ChatWindow>
    );
    expect(view.getByRole('textbox', { name: 'Kept' })).toBe(input);
  });

  it('adds no roles, labels or handlers of its own', () => {
    const view = render(<ChatWindow header="Trip" footer="Send">Body</ChatWindow>);
    expect(view.container.querySelectorAll('[role], [aria-label], [tabindex], button')).toHaveLength(0);
  });

  it('server renders without browser globals', () => {
    expect(renderToString(<ChatWindow header="Trip">Body</ChatWindow>)).toBe(
      '<div class="tp-chat-window"><div class="tp-chat-window__header">Trip</div><div class="tp-chat-window__body">Body</div></div>'
    );
  });
});
