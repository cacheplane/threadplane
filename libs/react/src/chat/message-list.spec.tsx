import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  streamingDelivery,
  type AgentSnapshot,
  type Message,
} from '@threadplane/core';
import {
  createMessageContent,
  type MessageRow,
} from '@threadplane/content/messages';
import { MessageList } from './index';

afterEach(cleanup);

const msg = (
  id: string,
  content: string,
  extra: Partial<Message> = {}
): Message =>
  Object.freeze({
    id,
    role: 'assistant',
    content,
    delivery: streamingDelivery('g'),
    ...extra,
  }) as Message;
const snap = (
  messages: Message[],
  toolCalls: AgentSnapshot['toolCalls'] = []
): AgentSnapshot =>
  Object.freeze({ status: 'idle', messages, toolCalls }) as AgentSnapshot;

describe('MessageList', () => {
  it('renders Markdown for text roles, literal text for tool role and tool observations', () => {
    const rows = createMessageContent().project(
      snap(
        [
          msg('u', 'Hi **there**', { role: 'user' }),
          msg('a', '# Plan', { toolCallIds: ['c'] }),
          msg('t', '<b>raw</b>', { role: 'tool', toolCallId: 'c' }),
        ],
        [
          Object.freeze({
            id: 'c',
            name: 'lookup',
            args: { q: 1 },
            status: 'complete',
            result: 'ok',
          }),
        ] as AgentSnapshot['toolCalls']
      )
    );
    const view = render(<MessageList rows={rows} />);
    expect(view.getByRole('heading', { name: 'Plan' })).toBeTruthy();
    expect(view.container.querySelector('strong')?.textContent).toBe('there');
    expect(
      view.container.querySelector('.tp-chat-message--tool pre')?.textContent
    ).toBe('<b>raw</b>');
    expect(view.container.querySelector('b')).toBeNull();
    const obs = view.getAllByRole('region', { name: 'Tool observation' });
    expect(obs).toHaveLength(1);
    expect(obs[0].textContent).toContain('lookup');
    expect(obs[0].textContent).toContain('"q": 1');
    expect(obs[0].textContent).toContain('ok');
  });

  it('shows error text for a failed tool call', () => {
    const rows = createMessageContent().project(
      snap([msg('a', 'x', { toolCallIds: ['c'] })], [
        Object.freeze({
          id: 'c',
          name: 'lookup',
          args: {},
          status: 'error',
          error: 'boom <i>bad</i>',
        }),
      ] as AgentSnapshot['toolCalls'])
    );
    const view = render(<MessageList rows={rows} />);
    expect(
      view.getByRole('region', { name: 'Tool observation' }).textContent
    ).toContain('boom <i>bad</i>');
    expect(view.container.querySelector('i')).toBeNull();
  });

  it('uses the default label and honours label and className', () => {
    const rows = createMessageContent().project(snap([]));
    const view = render(<MessageList rows={rows} />);
    expect(view.getByRole('region', { name: 'Conversation' })).toBeTruthy();
    view.rerender(<MessageList rows={rows} label="Chat" className="x" />);
    expect(
      view.getByRole('region', { name: 'Chat' }).classList.contains('x')
    ).toBe(true);
  });

  it('does not re-render unchanged rows when the tail streams', () => {
    const content = createMessageContent();
    const a = msg('a', 'stable');
    const renders: string[] = [];
    // Stable reference: memoization depends on it.
    type AuthoredRow = MessageRow & { readonly summary: string };
    const authored = new WeakMap<MessageRow, AuthoredRow>();
    const project = (messages: Message[]) =>
      content.project(snap(messages)).map((row) => {
        let decorated = authored.get(row);
        if (!decorated) {
          decorated = Object.freeze({ ...row, summary: `Summary ${row.id}` });
          authored.set(row, decorated);
        }
        return decorated;
      });
    const renderMessage = (row: AuthoredRow) => {
      renders.push(row.id);
      return (
        <p>
          {row.summary}: {row.message.content}
        </p>
      );
    };
    const view = render(
      <MessageList
        rows={project([a, msg('b', 'x')])}
        renderMessage={renderMessage}
      />
    );
    expect(renders.sort()).toEqual(['a', 'b']);
    renders.length = 0;
    view.rerender(
      <MessageList
        rows={project([a, msg('b', 'xy')])}
        renderMessage={renderMessage}
      />
    );
    expect(renders).toEqual(['b']);
    expect(view.getByText('Summary b: xy')).toBeTruthy();
  });

  it('follows new content only while pinned to the bottom', () => {
    const content = createMessageContent();
    const view = render(
      <MessageList rows={content.project(snap([msg('a', 'x')]))} />
    );
    const list = view.getByRole('region', { name: 'Conversation' });
    let scrollTop = 0;
    Object.defineProperty(list, 'scrollHeight', {
      configurable: true,
      get: () => 1000,
    });
    Object.defineProperty(list, 'clientHeight', {
      configurable: true,
      get: () => 200,
    });
    Object.defineProperty(list, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (v) => (scrollTop = v),
    });
    view.rerender(
      <MessageList
        rows={content.project(snap([msg('a', 'x'), msg('b', 'y')]))}
      />
    );
    expect(scrollTop).toBe(1000);
    scrollTop = 100;
    list.dispatchEvent(new Event('scroll'));
    view.rerender(
      <MessageList
        rows={content.project(
          snap([msg('a', 'x'), msg('b', 'y'), msg('c', 'z')])
        )}
      />
    );
    expect(scrollTop).toBe(100);
    scrollTop = 800;
    list.dispatchEvent(new Event('scroll'));
    view.rerender(
      <MessageList
        rows={content.project(
          snap([msg('a', 'x'), msg('b', 'y'), msg('c', 'z'), msg('d', 'w')])
        )}
      />
    );
    expect(scrollTop).toBe(1000);
  });
});
