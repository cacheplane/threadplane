import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  completeDelivery,
  type AgentSession,
  type AgentSnapshot,
  type Message,
} from '@threadplane/core';
import { createMessageContent } from '@threadplane/content/messages';
import { Chat, MessageList } from './index';

afterEach(cleanup);

const messages = [
  Object.freeze({
    id: 'u',
    role: 'user',
    content: 'What is $q$?',
    delivery: completeDelivery('u', 'success'),
  }),
  Object.freeze({
    id: 'a',
    role: 'assistant',
    content: 'It is $x^2$.',
    delivery: completeDelivery('a', 'success'),
  }),
] as unknown as Message[];
const snapshot = Object.freeze({
  status: 'idle',
  messages,
  toolCalls: [],
}) as AgentSnapshot;
const math = (latex: string) => `<b>${latex}</b>`;
const set = (view: ReturnType<typeof render>) =>
  Array.from(
    view.container.querySelectorAll('.tp-markdown__math'),
    (node) => node.innerHTML
  );

describe('math in the transcript', () => {
  it('MessageList typesets message text only when a renderer is given', () => {
    const rows = createMessageContent().project(snapshot);
    const view = render(<MessageList rows={rows} />);
    expect(set(view)).toEqual([]);
    expect(view.container.textContent).toContain('$x^2$');
    view.rerender(<MessageList rows={rows} math={math} />);
    expect(set(view)).toEqual(['<b>q</b>', '<b>x^2</b>']);
  });

  it('Chat passes the renderer to its transcript', () => {
    const session = {
      getSnapshot: () => snapshot,
      subscribe: () => () => undefined,
      submit: async () => 'success',
      stop: async () => undefined,
      dispose: async () => undefined,
    } as unknown as AgentSession;
    const view = render(<Chat session={session} />);
    expect(set(view)).toEqual([]);
    view.rerender(<Chat session={session} math={math} />);
    expect(set(view)).toEqual(['<b>q</b>', '<b>x^2</b>']);
  });
});
