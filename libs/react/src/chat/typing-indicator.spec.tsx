import { cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  streamingDelivery,
  type AgentSnapshot,
  type Message,
} from '@threadplane/core';
import * as chat from './index';

afterEach(cleanup);
const message = (role: Message['role'], content = ''): Message =>
  Object.freeze({ id: role, role, content, delivery: streamingDelivery(role) });

describe('isTyping', () => {
  for (const status of ['idle', 'error', 'running'] as const) {
    for (const [name, messages, waiting] of [
      ['empty', [], true],
      ['user', [message('user', 'Question')], true],
      ['empty assistant', [message('assistant')], true],
      ['assistant text', [message('assistant', 'First')], false],
      ['whitespace', [message('assistant', ' ')], false],
      ['tool', [message('tool')], false],
      ['system', [message('system')], false],
      ['last message only', [message('user'), message('tool')], false],
    ] as const) {
      it(`${status}: ${name}`, () => {
        const snapshot: Pick<AgentSnapshot, 'status' | 'messages'> =
          Object.freeze({
            status,
            messages: Object.freeze(messages),
          });
        expect(chat.isTyping(snapshot)).toBe(status === 'running' && waiting);
        expect(snapshot.messages).toBe(messages);
        expect(Object.isFrozen(snapshot.messages)).toBe(true);
      });
    }
  }
});

describe('TypingIndicator', () => {
  it('exports a controlled component and selector', () => {
    expect(chat.TypingIndicator).toBeTypeOf('function');
    expect(chat.isTyping).toBeTypeOf('function');
  });
  it('has no layout when inactive', () => {
    const view = render(<chat.TypingIndicator active={false} />);
    expect(view.container.childNodes).toHaveLength(0);
  });
  it('renders one polite atomic status with readable text and three decorative dots', () => {
    const view = render(<chat.TypingIndicator active className="mine" />);
    const status = view.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.getAttribute('aria-atomic')).toBe('true');
    expect(status.classList.contains('mine')).toBe(true);
    expect(view.getByText('Assistant is typing')).toBeTruthy();
    expect(status.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
    expect(view.queryByRole('button')).toBeNull();
  });
  it('keeps a literal custom label readable without live semantics', () => {
    const label = '<img src=x onerror=bad()> <script>literal</script>';
    const view = render(
      <chat.TypingIndicator active label={label} announce={false} />
    );
    expect(view.getByText(label)).toBeTruthy();
    expect(view.queryByRole('status')).toBeNull();
    expect(
      view.container.querySelector('[aria-live], [aria-atomic], img, script')
    ).toBeNull();
  });
  it('retains label DOM on equivalent updates and never changes focus', () => {
    const view = render(
      <>
        <input aria-label="Draft" />
        <StrictMode>
          <chat.TypingIndicator active />
        </StrictMode>
      </>
    );
    const input = view.getByRole('textbox');
    input.focus();
    const label = view.getByText('Assistant is typing');
    view.rerender(
      <>
        <input aria-label="Draft" />
        <StrictMode>
          <chat.TypingIndicator active />
        </StrictMode>
      </>
    );
    expect(view.getByText('Assistant is typing')).toBe(label);
    expect(document.activeElement).toBe(input);
    view.rerender(
      <>
        <input aria-label="Draft" />
        <StrictMode>
          <chat.TypingIndicator active label="Waiting" announce={false} />
        </StrictMode>
      </>
    );
    expect(view.getByText('Waiting')).toBe(label);
    expect(view.queryByRole('status')).toBeNull();
    expect(document.activeElement).toBe(input);
    view.rerender(
      <>
        <input aria-label="Draft" />
        <StrictMode>
          <chat.TypingIndicator active={false} />
        </StrictMode>
      </>
    );
    expect(view.queryByText('Waiting')).toBeNull();
    expect(document.activeElement).toBe(input);
    view.unmount();
  });
});
