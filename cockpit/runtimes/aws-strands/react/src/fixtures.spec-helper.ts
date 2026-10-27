import type { Session } from '@threadplane/ag-ui';
import { EventType as E } from '@ag-ui/client';
export type Snapshot = ReturnType<Session['getSnapshot']>;
export const meeting = { topic: 'Q3 roadmap review', slot: 'Tuesday 10:00' };
export const human = {
  id: 'human',
  role: 'user' as const,
  content: 'Book a fictional meeting.',
};
export const interrupt = () => ({
  id: 'opaque-native-interrupt',
  reason: 'book_meeting',
  metadata: { reason: { ...meeting } },
});
export const call = (id: string, name: string, args: unknown) => ({
  id,
  type: 'function' as const,
  function: { name, arguments: JSON.stringify(args) },
});
export const running = (): Snapshot => ({
  status: 'running',
  state: {},
  transcript: [human],
  subagents: [],
  run: { id: 'source' },
});
export const paused = (batch = false): Snapshot => ({
  ...running(),
  status: 'idle',
  state: {
    availability: batch ? null : { day: 'Tuesday', slots: ['10:00', '15:00'] },
    booking: { ...meeting, status: 'pending' },
  },
  transcript: [
    human,
    {
      id: 'lookup',
      role: 'assistant',
      content: '',
      toolCalls: [
        call('lookup-call', 'check_availability', { day: 'Tuesday' }),
        ...(batch ? [call('book-call', 'book_meeting', meeting)] : []),
      ],
    },
    ...(!batch
      ? [
          {
            id: 'lookup-result',
            role: 'tool' as const,
            toolCallId: 'lookup-call',
            content: JSON.stringify({
              day: 'Tuesday',
              slots: ['10:00', '15:00'],
            }),
          },
          {
            id: 'book',
            role: 'assistant' as const,
            content: '',
            toolCalls: [call('book-call', 'book_meeting', meeting)],
          },
        ]
      : []),
  ],
  decision: {
    kind: 'native',
    id: 'opaque-pause' as Parameters<Session['resume']>[0],
    sourceRunId: 'source',
    interrupts: [interrupt()],
  },
  run: {
    id: 'source',
    outcome: 'paused',
    terminal: {
      type: E.RUN_FINISHED,
      threadId: 'thread',
      runId: 'source',
      outcome: { type: 'interrupt', interrupts: [interrupt()] },
    },
  },
});
export const literal = (approved: boolean) =>
  approved
    ? `Meeting booked for ${meeting.slot}: ${meeting.topic}`
    : `The human declined. Meeting NOT booked: ${meeting.topic}`;
export const completed = (approved = true, batch = false): Snapshot => ({
  ...running(),
  status: 'idle',
  state: paused(batch).state,
  transcript: [
    ...paused(batch).transcript,
    ...(batch
      ? [
          {
            id: 'lookup-result',
            role: 'tool' as const,
            toolCallId: 'lookup-call',
            content: JSON.stringify({
              day: 'Tuesday',
              slots: ['10:00', '15:00'],
            }),
          },
        ]
      : []),
    {
      id: 'authoritative-result',
      role: 'tool',
      toolCallId: 'book-call',
      content: JSON.stringify(literal(approved)),
    },
    {
      id: 'prose',
      role: 'assistant',
      content: 'The fictional meeting request has been processed.',
    },
  ],
  run: {
    id: 'resume',
    outcome: 'success',
    terminal: { type: E.RUN_FINISHED, threadId: 'thread', runId: 'resume' },
  },
});
