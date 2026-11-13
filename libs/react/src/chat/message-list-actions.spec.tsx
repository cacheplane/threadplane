import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  completeDelivery,
  streamingDelivery,
  type AgentSession,
  type AgentSnapshot,
  type Message,
} from '@threadplane/core';
import { createMessageContent } from '@threadplane/content/messages';
import { Chat, MessageList } from './index';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const msg = (id: string, content: string, extra: Partial<Message> = {}): Message =>
  Object.freeze({ id, role: 'assistant', content, delivery: completeDelivery(id, 'success'), ...extra }) as Message;
const project = (messages: Message[]) =>
  createMessageContent().project(Object.freeze({ status: 'idle', messages, toolCalls: [] }) as AgentSnapshot);
const groups = (view: ReturnType<typeof render>) =>
  Array.from(view.container.querySelectorAll('.tp-message-actions--built-in'));
const clipboard = (writeText: (text: string) => Promise<void>) =>
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { clipboard: { writeText } }));
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('MessageList built-in message actions', () => {
  it('adds nothing unless asked', () => {
    for (const messageActions of [undefined, false] as const) {
      const view = render(<MessageList rows={project([msg('a', 'Answer')])} messageActions={messageActions} />);
      expect(groups(view)).toEqual([]);
      expect(view.queryByRole('button', { name: 'Copy' })).toBeNull();
      cleanup();
    }
  });

  it('offers Copy only under finished assistant messages that have text', () => {
    const rows = project([
      msg('u', 'Question', { role: 'user' }),
      msg('blank', '  '),
      msg('done', '**Answer**'),
      msg('stopped', 'Partial', { delivery: completeDelivery('g', 'aborted') }),
      msg('live', 'Writing', { delivery: streamingDelivery('g') }),
    ]);
    const view = render(<MessageList rows={rows} messageActions />);
    const owners = groups(view).map((group) => group.closest('article')?.textContent?.includes('Partial') ? 'stopped' : 'done');
    expect(owners).toEqual(['done', 'stopped']);
    const group = view.getAllByRole('group', { name: 'Message actions' })[0];
    expect(group.querySelectorAll('button').length).toBe(1);
    const copy = group.querySelector('button') as HTMLButtonElement;
    expect(copy.type).toBe('button');
    expect(copy.title).toBe('Copy');
    expect(copy.textContent).toBe('Copy');
    expect(view.queryByRole('group', { name: 'Rate response' })).toBeNull();
  });

  it('leaves a custom renderer in charge', () => {
    const view = render(
      <MessageList rows={project([msg('a', 'Answer')])} messageActions renderMessage={(row) => <p>{row.message.content}</p>} />
    );
    expect(groups(view)).toEqual([]);
  });

  it('copies the message source, reads Copied for two seconds and reports the copy', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async () => undefined);
    clipboard(writeText);
    const onCopy = vi.fn();
    const options = { onCopy };
    const view = render(<MessageList rows={project([msg('a', '**Answer**')])} messageActions={options} />);
    fireEvent.click(view.getByRole('button', { name: 'Copy' }));
    expect(onCopy).not.toHaveBeenCalled();
    await settle();
    expect(writeText.mock.calls).toEqual([['**Answer**']]);
    expect(onCopy.mock.calls).toEqual([['**Answer**', 'a']]);
    const copied = view.getByRole('button', { name: 'Copied' });
    expect(copied.title).toBe('Copied');
    expect(copied.hasAttribute('data-copied')).toBe(true);
    act(() => { vi.advanceTimersByTime(1999); });
    expect(view.queryByRole('button', { name: 'Copied' })).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(view.getByRole('button', { name: 'Copy' }).hasAttribute('data-copied')).toBe(false);
  });

  it('falls back to a selection copy when the clipboard refuses, and stays quiet when both fail', async () => {
    clipboard(async () => { throw new Error('denied'); });
    const exec = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
    const onCopy = vi.fn();
    const options = { onCopy };
    const view = render(<MessageList rows={project([msg('a', 'Answer')])} messageActions={options} />);
    const exec2 = exec.mockImplementation(() => {
      // The helper holds focus while the copy runs, as it does in a browser.
      (document.querySelector('body > textarea') as HTMLTextAreaElement).focus();
      return true;
    });
    view.getByRole('button', { name: 'Copy' }).focus();
    fireEvent.click(view.getByRole('button', { name: 'Copy' }));
    await settle();
    expect(exec2).toHaveBeenCalledWith('copy');
    expect(document.activeElement).toBe(view.getByRole('button', { name: 'Copied' }));
    expect(document.querySelector('body > textarea')).toBeNull();
    expect(onCopy.mock.calls).toEqual([['Answer', 'a']]);
    expect(view.queryByRole('button', { name: 'Copied' })).not.toBeNull();
    cleanup();
    exec.mockReturnValue(false);
    const next = render(<MessageList rows={project([msg('a', 'Answer')])} messageActions={options} />);
    fireEvent.click(next.getByRole('button', { name: 'Copy' }));
    await settle();
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(next.queryByRole('button', { name: 'Copied' })).toBeNull();
    Reflect.deleteProperty(document, 'execCommand');
  });

  it('adds a rating per message when onRate is given, keeps it and reports changes and clears', () => {
    const onRate = vi.fn();
    const options = { onRate };
    const view = render(<MessageList rows={project([msg('a', 'One'), msg('b', 'Two')])} messageActions={options} />);
    const ratings = view.getAllByRole('group', { name: 'Rate response' });
    expect(ratings.length).toBe(2);
    expect(ratings[1].parentElement?.classList.contains('tp-message-actions--built-in')).toBe(true);
    const [up, down] = Array.from(ratings[1].querySelectorAll('button'));
    fireEvent.click(up);
    expect(up.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(down);
    expect(up.getAttribute('aria-pressed')).toBe('false');
    expect(down.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(down);
    expect(down.getAttribute('aria-pressed')).toBe('false');
    expect(onRate.mock.calls).toEqual([['up', 'b'], ['down', 'b'], [null, 'b']]);
    expect(ratings[0].querySelector('[aria-pressed="true"]')).toBeNull();
  });
});

describe('Chat built-in message actions', () => {
  it('passes the option to its transcript', () => {
    const snapshot = Object.freeze({ status: 'idle', messages: [msg('a', 'Answer')], toolCalls: [] }) as AgentSnapshot;
    const session = {
      getSnapshot: () => snapshot,
      subscribe: () => () => undefined,
      submit: async () => 'success',
      stop: async () => undefined,
      dispose: async () => undefined,
    } as unknown as AgentSession;
    const view = render(<Chat session={session} />);
    expect(groups(view)).toEqual([]);
    view.rerender(<Chat session={session} messageActions />);
    expect(view.getByRole('button', { name: 'Copy' })).toBeTruthy();
  });
});
