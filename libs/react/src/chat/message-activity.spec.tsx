import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  completeDelivery,
  type AgentSession,
  type AgentSnapshot,
} from '@threadplane/core';
import { Chat, type MessageActivityContext } from './index';

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
const done = (id: string) => completeDelivery(id, 'success');
const turn = {
  messages: [
    { id: 'u', role: 'user', content: 'Find it', delivery: done('u') },
    {
      id: 'a',
      role: 'assistant',
      content: 'Found it.',
      reasoning: 'Thinking it through',
      toolCallIds: ['call'],
      delivery: done('a'),
    },
    { id: 'b', role: 'assistant', content: 'Anything else?', delivery: done('b') },
  ],
  toolCalls: [
    { id: 'call', name: 'lookup', args: { q: 'it' }, status: 'complete', result: 'ok' },
  ],
} as unknown as Partial<AgentSnapshot>;

const summary = ({ row, toolCalls }: MessageActivityContext) => (
  <p data-testid={`activity-${row.id}`}>
    {toolCalls.map((call) => call.name).join(',') || 'no calls'}
  </p>
);
const builtIn = (view: ReturnType<typeof render>) => ({
  reasoning: view.container.querySelector('.tp-reasoning'),
  tools: view.container.querySelector('.tp-tool-activity, .tp-tool-group'),
});

describe('Chat message activity', () => {
  it('shows the built-in reasoning and tool area without a renderer', () => {
    const { session } = fakeSession(turn);
    const view = render(<Chat session={session} />);
    const found = builtIn(view);
    expect(found.reasoning).not.toBeNull();
    expect(found.tools).not.toBeNull();
  });

  it('replaces reasoning and tool calls of each assistant message, above its text', () => {
    const { session } = fakeSession(turn);
    const view = render(<Chat session={session} renderMessageActivity={summary} />);
    const found = builtIn(view);
    expect(found.reasoning).toBeNull();
    expect(found.tools).toBeNull();
    const first = view.getByTestId('activity-a');
    expect(first.textContent).toBe('lookup');
    expect(view.getByTestId('activity-b').textContent).toBe('no calls');
    expect(view.queryByTestId('activity-u')).toBeNull();
    const text = view.getByText('Found it.');
    expect(
      first.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(view.getByText('Anything else?')).not.toBeNull();
  });

  it('does not use the per-call renderers while it returns content', () => {
    const { session } = fakeSession(turn);
    const renderToolCall = vi.fn(() => <span>custom call</span>);
    const view = render(
      <Chat
        session={session}
        renderMessageActivity={summary}
        renderToolCall={renderToolCall}
      />
    );
    expect(view.queryByText('custom call')).toBeNull();
  });

  it('keeps the built-in area for a message when it returns undefined', () => {
    const { session } = fakeSession(turn);
    const view = render(
      <Chat
        session={session}
        renderMessageActivity={(context) =>
          context.row.id === 'b' ? summary(context) : undefined
        }
      />
    );
    const found = builtIn(view);
    expect(found.reasoning).not.toBeNull();
    expect(found.tools).not.toBeNull();
    expect(view.queryByTestId('activity-a')).toBeNull();
    expect(view.getByTestId('activity-b')).not.toBeNull();
  });

  it('shows nothing in the area when it returns null', () => {
    const { session } = fakeSession(turn);
    const view = render(<Chat session={session} renderMessageActivity={() => null} />);
    const found = builtIn(view);
    expect(found.reasoning).toBeNull();
    expect(found.tools).toBeNull();
    expect(view.getByText('Found it.')).not.toBeNull();
  });

  it('passes the child agents started by the message', () => {
    const { session } = fakeSession(turn);
    const seen = vi.fn(summary);
    const child = { id: 'c', toolCallId: 'call', name: 'Researcher', status: 'complete', messages: [] };
    render(
      <Chat
        session={session}
        renderMessageActivity={seen}
        subagents={[child] as never}
      />
    );
    const forA = seen.mock.calls.map(([context]) => context).find((context) => context.row.id === 'a');
    expect(forA?.subagents.map((subagent) => subagent.id)).toEqual(['c']);
    const forB = seen.mock.calls.map(([context]) => context).find((context) => context.row.id === 'b');
    expect(forB?.subagents).toEqual([]);
  });

  it('leaves a custom renderMessage in full ownership', () => {
    const { session } = fakeSession(turn);
    const seen = vi.fn(summary);
    const view = render(
      <Chat
        session={session}
        renderMessage={(row) => <p>{row.id}</p>}
        renderMessageActivity={seen}
      />
    );
    expect(seen).not.toHaveBeenCalled();
    expect(view.queryByTestId('activity-a')).toBeNull();
  });
});
