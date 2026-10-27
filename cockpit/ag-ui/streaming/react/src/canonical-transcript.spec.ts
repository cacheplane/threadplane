import { EventType } from '@ag-ui/client';
import { expect, it } from 'vitest';
import {
  captureTurn,
  confirmTranscript,
  type NativeSnapshot,
  type OwnedTurn,
} from './canonical-transcript';

const prefix = [
  { id: 'human-A', role: 'user' as const, content: 'First question' },
  { id: 'answer-A', role: 'assistant' as const, content: 'First answer' },
];
const human = {
  id: 'human-B',
  role: 'user' as const,
  content: '  Current question  ',
};
const answer = {
  id: 'answer-B',
  role: 'assistant' as const,
  content: 'Current answer',
};
const admitted = (): NativeSnapshot => ({
  status: 'running',
  state: {},
  subagents: [],
  transcript: [...prefix, human],
  run: { id: 'run-B' },
});
const turn = (): OwnedTurn => ({
  threadId: 'thread-A',
  runId: 'run-B',
  human,
  prefix,
});
const final = (): NativeSnapshot => ({
  ...admitted(),
  status: 'idle',
  transcript: [...prefix, human, answer],
  run: {
    id: 'run-B',
    outcome: 'success',
    terminal: {
      type: EventType.RUN_FINISHED,
      threadId: 'thread-A',
      runId: 'run-B',
    },
  },
});

it('captures the actual admitted native human/run and preceding confirmed prefix', () => {
  expect(captureTurn(admitted(), 'thread-A', 'run-A', prefix)).toEqual(turn());
});
it('confirms only current ordinary native history without inventing delivery fields', () => {
  const rows = confirmTranscript(final(), turn());
  expect(rows).toEqual([...prefix, human, answer]);
  expect(rows?.[2]).not.toHaveProperty('delivery');
});
it('accepts explicit native success and legacy omitted success outcome', () => {
  const snapshot = final();
  const terminal = snapshot.run!.terminal!;
  if (terminal.type !== EventType.RUN_FINISHED)
    throw new Error('Expected finished fixture');
  expect(
    confirmTranscript(
      {
        ...snapshot,
        run: {
          ...snapshot.run!,
          terminal: {
            ...terminal,
            outcome: { type: 'success', pendingToolCallIds: [] },
          },
        },
      },
      turn()
    )
  ).toEqual(snapshot.transcript);
});
it('captures and confirms a first turn with no previous native history', () => {
  expect(
    captureTurn(
      { ...admitted(), transcript: [human] },
      'thread-A',
      undefined,
      []
    )
  ).toEqual({ ...turn(), prefix: [] });
  expect(
    confirmTranscript(
      { ...final(), transcript: [human, answer] },
      { ...turn(), prefix: [] }
    )
  ).toEqual([human, answer]);
});

it.each([
  { status: 'idle' as const },
  { run: { id: 'run-A' } },
  { run: undefined },
  { transcript: [...prefix] },
  { transcript: [...prefix, answer] },
  { transcript: [prefix[1], prefix[0], human] },
  {
    transcript: [
      { ...prefix[0], content: 'Changed question' },
      prefix[1],
      human,
    ],
  },
  { transcript: [...prefix, { ...human, id: prefix[0].id }] },
])('rejects stale or malformed native admission: %j', (change) => {
  expect(
    captureTurn({ ...admitted(), ...change }, 'thread-A', 'run-A', prefix)
  ).toBeUndefined();
});
it.each([
  { status: 'running' as const },
  { status: 'error' as const },
  { run: { ...final().run!, outcome: 'interrupted' as const } },
  { run: { ...final().run!, outcome: 'paused' as const } },
  { run: { ...final().run!, outcome: 'aborted' as const } },
  { run: { ...final().run!, id: 'old-run' } },
  { run: { id: 'run-B', outcome: 'success' as const } },
  {
    run: {
      ...final().run!,
      terminal: {
        type: EventType.RUN_FINISHED as const,
        threadId: 'other-thread',
        runId: 'run-B',
      },
    },
  },
  {
    run: {
      ...final().run!,
      terminal: {
        type: EventType.RUN_FINISHED as const,
        threadId: 'thread-A',
        runId: 'old-run',
      },
    },
  },
  {
    run: {
      ...final().run!,
      terminal: { type: EventType.RUN_ERROR as const, message: 'private' },
    },
  },
  {
    run: {
      ...final().run!,
      terminal: {
        type: EventType.RUN_FINISHED as const,
        threadId: 'thread-A',
        runId: 'run-B',
        outcome: { type: 'success' as const, pendingToolCallIds: ['call'] },
      },
    },
  },
  { transcript: [human, answer] },
  { transcript: [prefix[1], prefix[0], human, answer] },
  {
    transcript: [
      { ...prefix[0], content: 'Changed prior question' },
      prefix[1],
      human,
      answer,
    ],
  },
  { transcript: [...prefix, { ...human, content: 'Wrong question' }, answer] },
  { transcript: [...prefix, human, { ...answer, content: '' }] },
  { transcript: [...prefix, human, { ...answer, id: human.id }] },
  { transcript: [...prefix, human, answer, { ...answer, id: 'extra' }] },
  { transcript: [...prefix, human, { ...answer, subagentRunId: 'child' }] },
  {
    transcript: [
      ...prefix,
      human,
      {
        ...answer,
        toolCalls: [
          {
            id: 'call',
            type: 'function' as const,
            function: { name: 'weather', arguments: '{}' },
          },
        ],
      },
    ],
  },
  {
    transcript: [
      ...prefix,
      human,
      {
        id: 'tool',
        role: 'tool' as const,
        content: 'Result',
        toolCallId: 'call',
      },
    ],
  },
  {
    subagents: [
      {
        started: {
          type: EventType.SUBAGENT_STARTED as const,
          subagentRunId: 'child',
          name: 'worker',
        },
      },
    ],
  },
  {
    run: {
      ...final().run!,
      legacyInterrupt: {
        type: EventType.CUSTOM as const,
        name: 'on_interrupt',
        value: {},
      },
    },
  },
])('rejects unconfirmed native terminal/history: %j', (change) => {
  expect(confirmTranscript({ ...final(), ...change }, turn())).toBeUndefined();
});
it('respects revoked authority during native capture and final confirmation', () => {
  expect(
    captureTurn(admitted(), 'thread-A', 'run-A', prefix, () => false)
  ).toBeUndefined();
  expect(confirmTranscript(final(), turn(), () => false)).toBeUndefined();
  let active = true;
  const snapshot = {
    ...final(),
    get transcript() {
      active = false;
      return final().transcript;
    },
  };
  expect(confirmTranscript(snapshot, turn(), () => active)).toBeUndefined();
});
