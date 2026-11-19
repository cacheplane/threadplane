import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  completeDelivery,
  streamingDelivery,
  type AgentSession,
  type AgentSnapshot,
} from '@threadplane/core';
import { Chat, type ChatRunActivityContext } from './index';

afterEach(cleanup);

function fakeSession(initial: Partial<AgentSnapshot> = {}) {
  let snapshot = Object.freeze({
    status: 'idle',
    messages: [],
    toolCalls: [],
    ...initial,
  }) as AgentSnapshot;
  const listeners = new Set<() => void>();
  const raw = {
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    submit: vi.fn(async () => 'success' as const),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  const set = (next: Partial<AgentSnapshot>) => {
    snapshot = Object.freeze({ ...snapshot, ...next }) as AgentSnapshot;
    act(() => listeners.forEach((notify) => notify()));
  };
  return { session: raw as unknown as AgentSession, set };
}
type Messages = AgentSnapshot['messages'];
const user = (id: string, content: string): Messages[number] => ({
  id,
  role: 'user',
  content,
  delivery: completeDelivery(id, 'success'),
});
const answered: Messages = [
  user('u0', 'Earlier'),
  { id: 'a0', role: 'assistant', content: 'Earlier answer', delivery: completeDelivery('a0', 'success') },
];
const asked: Messages = [...answered, user('u1', 'Next')];
const streaming: Messages = [
  ...asked,
  { id: 'a1', role: 'assistant', content: 'Work', delivery: streamingDelivery('a1') },
];
const activity = ({ messages }: ChatRunActivityContext) => (
  <p data-testid="activity">Working on {messages.length} run messages</p>
);
const region = (view: ReturnType<typeof render>) =>
  view.container.querySelector('.tp-chat__run-activity');
const typing = (view: ReturnType<typeof render>) =>
  view.container.querySelector('.tp-typing-indicator');

describe('Chat run activity', () => {
  it('keeps the typing indicator when the app passes no renderer', () => {
    const { session } = fakeSession({ status: 'running', messages: asked });
    const view = render(<Chat session={session} />);
    expect(region(view)).toBeNull();
    expect(typing(view)).not.toBeNull();
  });

  it('replaces the typing indicator, in a polite status region after the last message', () => {
    const { session } = fakeSession({ status: 'running', messages: asked });
    const view = render(<Chat session={session} renderRunActivity={activity} />);
    const host = region(view)!;
    expect(host.getAttribute('role')).toBe('status');
    expect(host.getAttribute('aria-atomic')).toBe('false');
    expect(host.textContent).toBe('Working on 0 run messages');
    expect(typing(view)).toBeNull();
    const rows = view.container.querySelectorAll('.tp-chat-message');
    expect(
      rows[rows.length - 1].compareDocumentPosition(host) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('is not shown while idle, and appears when the run starts', () => {
    const { session, set } = fakeSession({ messages: answered });
    const view = render(<Chat session={session} renderRunActivity={activity} />);
    expect(region(view)).toBeNull();
    set({ status: 'running', messages: asked });
    expect(region(view)).not.toBeNull();
  });

  it('passes only the messages after the last user message', () => {
    const tool = { id: 't1', role: 'tool', content: 'ok', delivery: completeDelivery('t1', 'success') } as unknown as Messages[number];
    const { session } = fakeSession({ status: 'running', messages: [...asked, tool] });
    const seen = vi.fn(activity);
    render(<Chat session={session} renderRunActivity={seen} />);
    expect(seen.mock.lastCall?.[0].messages.map((message) => message.id)).toEqual(['t1']);
  });

  it('leaves when the first assistant message arrives and does not return for that run', () => {
    const { session, set } = fakeSession({ status: 'running', messages: asked });
    const view = render(<Chat session={session} renderRunActivity={activity} />);
    expect(region(view)).not.toBeNull();
    set({ messages: streaming });
    expect(region(view)).toBeNull();
    set({ status: 'idle' });
    expect(region(view)).toBeNull();
  });

  it('never shows for a run that continues an existing assistant message', () => {
    const { session } = fakeSession({ status: 'running', messages: answered });
    const view = render(<Chat session={session} renderRunActivity={activity} />);
    expect(region(view)).toBeNull();
  });

  it('falls back to the typing indicator when the renderer returns null', () => {
    const { session } = fakeSession({ status: 'running', messages: asked });
    const view = render(<Chat session={session} renderRunActivity={() => null} />);
    expect(region(view)).toBeNull();
    expect(typing(view)).not.toBeNull();
  });

  it('gives the renderer the same run messages while only the status changes', () => {
    const { session, set } = fakeSession({ status: 'running', messages: asked });
    const seen = vi.fn(activity);
    render(<Chat session={session} renderRunActivity={seen} />);
    const first = seen.mock.lastCall?.[0].messages;
    set({ toolCalls: [] });
    expect(seen.mock.lastCall?.[0].messages).toBe(first);
  });
});
