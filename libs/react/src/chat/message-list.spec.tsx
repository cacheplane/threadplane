import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
  it('retains row-update following when ResizeObserver is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const content = createMessageContent();
    const view = render(
      <MessageList rows={content.project(snap([msg('a', 'A')]))} />
    );
    const list = view.getByRole('region', { name: 'Conversation' });
    let top = 0;
    Object.defineProperties(list, {
      scrollHeight: { configurable: true, get: () => 900 },
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value) => {
          top = value;
        },
      },
    });
    view.rerender(
      <MessageList
        rows={content.project(snap([msg('a', 'A'), msg('b', 'B')]))}
      />
    );
    expect(top).toBe(900);
    content.dispose();
  });
  it('follows unchanged-row height growth only while pinned and releases its observer', () => {
    let notify: () => void = () => {
      throw new Error('Resize observer was not installed');
    };
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          notify = () => callback([], this as unknown as ResizeObserver);
        }
        observe = observe;
        unobserve = vi.fn();
        disconnect = disconnect;
      }
    );
    const content = createMessageContent();
    const rows = content.project(snap([msg('a', 'Unchanged')]));
    const view = render(<MessageList rows={rows} />);
    const list = view.getByRole('region', { name: 'Conversation' });
    let height = 1000;
    let top = 800;
    Object.defineProperties(list, {
      scrollHeight: { configurable: true, get: () => height },
      clientHeight: { configurable: true, get: () => 200 },
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value) => {
          top = value;
        },
      },
    });
    height = 1400;
    act(notify);
    expect(top).toBe(1400);
    expect(observe).toHaveBeenCalledWith(list.firstElementChild);
    top = 100;
    fireEvent.scroll(list);
    height = 1800;
    act(notify);
    expect(top).toBe(100);
    top = 1600;
    fireEvent.scroll(list);
    height = 2000;
    act(notify);
    expect(top).toBe(2000);
    expect(view.getByText('Unchanged').textContent).toBe('Unchanged');
    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
    height = 2500;
    act(notify);
    expect(top).toBe(2000);
    content.dispose();
  });
  it('disconnects replayed observers and ignores their stale callbacks in StrictMode', () => {
    const notifications: (() => void)[] = [];
    const disconnects: ReturnType<typeof vi.fn>[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          notifications.push(() =>
            callback([], this as unknown as ResizeObserver)
          );
          disconnects.push(this.disconnect);
        }
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      }
    );
    const content = createMessageContent();
    const view = render(
      <StrictMode>
        <MessageList rows={content.project(snap([msg('a', 'Text')]))} />
      </StrictMode>
    );
    const list = view.getByRole('region', { name: 'Conversation' });
    let top = 0;
    Object.defineProperties(list, {
      scrollHeight: { configurable: true, get: () => 1000 },
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value) => {
          top = value;
        },
      },
    });
    expect(notifications).toHaveLength(2);
    expect(disconnects[0]).toHaveBeenCalledTimes(1);
    act(notifications[0]);
    expect(top).toBe(0);
    act(notifications[1]);
    expect(top).toBe(1000);
    view.unmount();
    expect(disconnects[1]).toHaveBeenCalledTimes(1);
    content.dispose();
  });
  it('shows supplied citations only on default assistant rows and respects custom rendering', () => {
    const content = createMessageContent();
    const citations = [{ id: 'c', index: 1, title: 'Owned source' }] as const;
    const rows = content.project(
      snap(
        ['assistant', 'user', 'tool'].map((role) =>
          msg(role, 'Answer', { role: role as Message['role'], citations })
        )
      )
    );
    const view = render(<MessageList rows={rows} />);
    expect(view.getAllByRole('region', { name: 'Sources' })).toHaveLength(1);
    expect(view.getAllByText('Owned source')).toHaveLength(1);
    view.rerender(
      <MessageList rows={rows} renderMessage={(row) => <p>{row.id}</p>} />
    );
    expect(view.queryByRole('region', { name: 'Sources' })).toBeNull();
    content.dispose();
  });
  it('renders reasoning only for assistants and resets disclosure after removal', () => {
    const content = createMessageContent();
    const other = ['user', 'system', 'tool'].map((role) =>
      msg(role, role, {
        role: role as Message['role'],
        reasoning: `Hidden ${role}`,
      })
    );
    const assistant = msg('a', 'Answer', { reasoning: '**Why**' });
    const view = render(
      <MessageList rows={content.project(snap([...other, assistant]))} />
    );
    expect(view.getAllByRole('button', { name: 'Thinking…' })).toHaveLength(1);
    expect(view.getByRole('region', { name: 'Reasoning' }).textContent).toBe(
      'Why'
    );
    fireEvent.click(view.getByRole('button', { name: 'Thinking…' }));
    view.rerender(
      <MessageList
        rows={content.project(snap([...other, msg('a', 'Answer')]))}
      />
    );
    expect(view.queryByRole('button')).toBeNull();
    view.rerender(
      <MessageList rows={content.project(snap([...other, assistant]))} />
    );
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    content.dispose();
  });

  it('leaves reasoning presentation to a custom renderer', () => {
    const content = createMessageContent();
    const view = render(
      <MessageList
        rows={content.project(snap([msg('a', 'Answer', { reasoning: 'Why' })]))}
        renderMessage={(row) => <p>{row.message.content}</p>}
      />
    );
    expect(view.getByText('Answer')).toBeTruthy();
    expect(view.queryByRole('button')).toBeNull();
    content.dispose();
  });

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
