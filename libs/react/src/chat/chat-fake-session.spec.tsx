import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
} from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import {
  createFakeAgentSession,
  type FakeAssistantStream,
} from '@threadplane/core/testing';
import { useAgent } from '../use-agent';
import { Chat } from './index';

afterEach(cleanup);

it('submits from the Chat composer and shows a reply streamed by the fake session', async () => {
  let reply: FakeAssistantStream | undefined;
  const fake = createFakeAgentSession({
    onSubmit: (input, session) => {
      reply = session.stream();
      reply.append(`Echo: ${input}`);
    },
  });
  const view = render(<Chat session={fake.session} />);
  const box = view.getByRole('textbox', { name: 'Message' });
  fireEvent.change(box, { target: { value: '  Hello  ' } });
  await act(async () => {
    fireEvent.click(view.getByRole('button', { name: 'Send' }));
  });

  expect(fake.submits.map((call) => call.input)).toEqual(['Hello']);
  expect(view.getByText('Hello')).toBeTruthy();
  expect(view.getByText('Echo: Hello')).toBeTruthy();
  expect(fake.session.getSnapshot().status).toBe('running');
  expect(view.getByRole('button', { name: 'Stop' })).toBeTruthy();

  act(() => {
    reply?.append(' and more');
    reply?.complete();
  });
  expect(view.getByText('Echo: Hello and more')).toBeTruthy();
  expect(fake.session.getSnapshot().status).toBe('idle');
  expect(view.queryByRole('button', { name: 'Stop' })).toBeNull();
});

it('stops a running reply from the Chat Stop button', async () => {
  const fake = createFakeAgentSession();
  const view = render(<Chat session={fake.session} />);
  act(() => {
    fake.stream({ text: 'Partial' });
  });
  await act(async () => {
    fireEvent.click(view.getByRole('button', { name: 'Stop' }));
  });
  expect(fake.stopCount).toBe(1);
  expect(fake.session.getSnapshot().status).toBe('idle');
  expect(view.getByText('Partial')).toBeTruthy();
});

it('drives useAgent through the fake session controls', () => {
  const fake = createFakeAgentSession();
  const { result } = renderHook(() => useAgent(fake.session));
  const initial = result.current;
  expect(initial.messages).toEqual([]);
  act(() => {
    fake.push({ role: 'assistant', content: 'Hi' });
    fake.setError({ kind: 'server', message: 'Down', retryable: true });
  });
  expect(result.current).not.toBe(initial);
  expect(result.current.messages.map((m) => m.content)).toEqual(['Hi']);
  expect(result.current.status).toBe('error');
  expect(result.current.error?.message).toBe('Down');
});

it('shows the child agents the session reports, with no subagents prop', () => {
  const fake = createFakeAgentSession();
  const view = render(<Chat session={fake.session} />);
  act(() => {
    fake.set({
      messages: [
        { role: 'user', content: 'Research it' },
        { role: 'assistant', content: 'Delegating', toolCallIds: ['task-1'] },
        { role: 'assistant', content: 'Here is the summary' },
      ],
      toolCalls: [
        { id: 'task-1', name: 'task', args: {}, status: 'complete', result: 1 },
      ],
      subagents: [
        {
          // Related to the root call that started it: the card takes its place.
          id: 'anchored',
          name: 'researcher',
          toolCallId: 'task-1',
          messages: [
            {
              role: 'assistant',
              content: 'Found two sources',
              toolCallIds: ['search-1'],
            },
          ],
          toolCalls: [
            {
              id: 'search-1',
              name: 'search',
              args: { q: 'sources' },
              status: 'complete',
              result: 'ok',
            },
          ],
        },
        // Related to no call, as a LangGraph child graph is.
        { id: 'loose', name: 'writer', status: 'error', error: 'It failed' },
      ],
    });
  });
  const cards = [
    ...view.container.querySelectorAll<HTMLElement>('[data-subagent-id]'),
  ];
  expect(cards.map((card) => card.dataset['subagentId'])).toEqual([
    'anchored',
    'loose',
  ]);
  expect(cards[0].textContent).toContain('researcher');
  expect(cards[0].textContent).toContain('Found two sources');
  expect(cards[1].textContent).toContain('writer');
  expect(cards[1].textContent).toContain('It failed');
  // Both belong to the turn's first assistant message, not the last one.
  const first = view.getByText('Delegating').closest('.tp-chat-message');
  expect(first?.contains(cards[0])).toBe(true);
  expect(first?.contains(cards[1])).toBe(true);
  // The delegating call is the card, not also a tool row.
  expect(view.queryByText('task')).toBeNull();
});

it('lets the subagents prop replace the session child agents', () => {
  const fake = createFakeAgentSession({
    subagents: [{ id: 'reported', name: 'reported-child' }],
    messages: [
      { role: 'user', content: 'Go' },
      { role: 'assistant', content: 'Done', toolCallIds: ['task-1'] },
    ],
    toolCalls: [
      { id: 'task-1', name: 'task', args: {}, status: 'complete', result: 1 },
    ],
  });
  const none = render(<Chat session={fake.session} subagents={[]} />);
  expect(none.container.querySelector('[data-subagent-id]')).toBeNull();
  none.unmount();
  const own = render(
    <Chat
      session={fake.session}
      subagents={[
        {
          id: 'mine',
          toolCallId: 'task-1',
          name: 'app-child',
          status: 'complete',
          messages: [],
        },
      ]}
    />
  );
  expect(
    [...own.container.querySelectorAll<HTMLElement>('[data-subagent-id]')].map(
      (card) => card.dataset['subagentId']
    )
  ).toEqual(['mine']);
});
