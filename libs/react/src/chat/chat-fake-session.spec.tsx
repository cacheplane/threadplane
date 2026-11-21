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
import type { AgentSession, CompleteOutcome } from '@threadplane/core';
import { useAgent } from '../use-agent';
import { Chat, type RenderInterrupt } from './index';

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

const card: RenderInterrupt = (interrupt, respond) => (
  <div data-interrupt={interrupt.id} data-answered={String(respond.answered)}>
    <p>{interrupt.message}</p>
    <button
      type="button"
      disabled={respond.sending}
      onClick={() => respond.resolve({ approved: true })}
    >
      Approve {interrupt.id}
    </button>
    <button type="button" onClick={() => respond.cancel()}>
      Cancel {interrupt.id}
    </button>
  </div>
);

it('shows nothing for a pending interrupt unless renderInterrupt is set', () => {
  const fake = createFakeAgentSession({
    interrupts: [{ id: 'i1', message: 'Refund $20?' }],
  });
  const view = render(<Chat session={fake.session} />);
  expect(view.queryByText('Refund $20?')).toBeNull();
  expect(
    view.getByRole('textbox', { name: 'Message' }).getAttribute('placeholder')
  ).not.toBe('Answer the approval to continue');
});

it('answers one interrupt through session.resume from renderInterrupt', async () => {
  const fake = createFakeAgentSession({
    interrupts: [{ id: 'i1', message: 'Refund $20?' }],
  });
  const view = render(<Chat session={fake.session} renderInterrupt={card} />);
  expect(view.getByText('Refund $20?')).toBeTruthy();
  // The composer waits on the answer, as it does for the approval slot.
  expect(
    view.getByRole('textbox', { name: 'Message' }).getAttribute('placeholder')
  ).toBe('Answer the approval to continue');
  await act(async () => {
    fireEvent.click(view.getByRole('button', { name: 'Approve i1' }));
  });
  expect(fake.resumes.map((call) => call.responses)).toEqual([
    [{ interruptId: 'i1', status: 'resolved', value: { approved: true } }],
  ]);
  // The fake removes an answered interrupt; the card goes with it.
  expect(view.queryByText('Refund $20?')).toBeNull();
});

it('holds answers until every pending interrupt has one, then sends them together', async () => {
  const fake = createFakeAgentSession({
    interrupts: [
      { id: 'i1', message: 'First?' },
      { id: 'i2', message: 'Second?' },
    ],
  });
  const view = render(<Chat session={fake.session} renderInterrupt={card} />);
  await act(async () => {
    fireEvent.click(view.getByRole('button', { name: 'Cancel i2' }));
  });
  expect(fake.resumes).toHaveLength(0);
  expect(
    view.container
      .querySelector('[data-interrupt="i2"]')
      ?.getAttribute('data-answered')
  ).toBe('true');
  await act(async () => {
    fireEvent.click(view.getByRole('button', { name: 'Approve i1' }));
  });
  // One resume, in the order the session lists the interrupts.
  expect(fake.resumes.map((call) => call.responses)).toEqual([
    [
      { interruptId: 'i1', status: 'resolved', value: { approved: true } },
      { interruptId: 'i2', status: 'cancelled' },
    ],
  ]);
});

it('lets the interrupts be answered again after resume rejects', async () => {
  let fail = true;
  const fake = createFakeAgentSession({
    interrupts: [{ id: 'i1', message: 'Refund $20?' }],
  });
  // A session that refuses the first answer and leaves the interrupt pending.
  const session: AgentSession = {
    ...fake.session,
    resume: (responses, options) =>
      fail
        ? Promise.reject(new TypeError('Not accepted'))
        : (fake.session.resume?.(
            responses,
            options
          ) as Promise<CompleteOutcome>),
  };
  const errors: unknown[] = [];
  const view = render(
    <Chat
      session={session}
      renderInterrupt={card}
      onInterruptError={(error) => errors.push(error)}
    />
  );
  await act(async () => {
    fireEvent.click(view.getByRole('button', { name: 'Approve i1' }));
  });
  expect(errors).toHaveLength(1);
  expect(errors[0]).toBeInstanceOf(TypeError);
  expect(fake.resumes).toHaveLength(0);
  // Still pending, and its control is usable again.
  const again = view.getByRole('button', { name: 'Approve i1' });
  expect((again as HTMLButtonElement).disabled).toBe(false);
  fail = false;
  await act(async () => {
    fireEvent.click(again);
  });
  expect(errors).toHaveLength(1);
  expect(fake.resumes).toHaveLength(1);
  expect(view.queryByText('Refund $20?')).toBeNull();
});

it('leaves the approval slot to the app when approval is set', () => {
  const fake = createFakeAgentSession({
    interrupts: [{ id: 'i1', message: 'Refund $20?' }],
  });
  const view = render(
    <Chat
      session={fake.session}
      renderInterrupt={card}
      approval={<p>App approval</p>}
    />
  );
  expect(view.getByText('App approval')).toBeTruthy();
  expect(view.queryByText('Refund $20?')).toBeNull();
});
