import { describe, expect, it } from 'vitest';
import { EventType } from '@ag-ui/core';
import { confirmParent, type OwnedTurn } from './policy';
import { observeChildren, type NativeSnapshot } from './children';

const human = {
  id: 'human',
  role: 'user' as const,
  content: 'Plan a fictional trip.',
};
const turn: OwnedTurn = { threadId: 'thread', runId: 'run', human, prefix: [] };
function healthy(): NativeSnapshot {
  return {
    status: 'idle',
    state: {},
    run: {
      id: 'run',
      outcome: 'success',
      terminal: {
        type: EventType.RUN_FINISHED,
        threadId: 'thread',
        runId: 'run',
      },
    },
    transcript: [
      human,
      {
        id: 'owner',
        role: 'assistant',
        toolCalls: [
          {
            id: 'call',
            type: 'function',
            function: {
              name: 'task',
              arguments: JSON.stringify({
                role: 'research',
                task_description: 'A fictional trip.',
              }),
            },
          },
        ],
      },
      {
        id: 'call',
        role: 'tool',
        toolCallId: 'call',
        content: 'A specialist answer.',
      },
      { id: 'answer', role: 'assistant', content: 'A parent answer.' },
    ],
    subagents: [
      {
        started: {
          type: EventType.SUBAGENT_STARTED,
          subagentRunId: 'call-sub',
          name: 'research',
          parentToolCallId: 'call',
        },
        terminal: {
          type: EventType.SUBAGENT_FINISHED,
          subagentRunId: 'call-sub',
          outcome: { type: 'success' },
        },
      },
    ],
  };
}
describe('root completion alone admits a follow-up', () => {
  it('rejects terminal pending tools even when the observed root transcript looks complete', () => {
    const source = healthy();
    const snapshot: NativeSnapshot = {
      ...source,
      run: {
        ...source.run!,
        terminal: {
          type: EventType.RUN_FINISHED,
          threadId: 'thread',
          runId: 'run',
          outcome: { type: 'success', pendingToolCallIds: ['unresolved'] },
        },
      },
    };
    expect(
      confirmParent(
        snapshot,
        turn,
        observeChildren(source, [], new Set()).cards
      )
    ).toBeUndefined();
  });
  it('rejects another user in the causal suffix after the captured admission', () => {
    const source = healthy();
    const snapshot: NativeSnapshot = {
      ...source,
      transcript: [
        source.transcript[0],
        {
          id: 'foreign-human',
          role: 'user',
          content: 'An unadmitted request.',
        },
        ...source.transcript.slice(1),
      ],
    };
    expect(
      confirmParent(
        snapshot,
        turn,
        observeChildren(source, [], new Set()).cards
      )
    ).toBeUndefined();
  });
  it('borrows the full causal native history after current root success', () => {
    const snapshot = healthy();
    const cards = observeChildren(snapshot, [], new Set()).cards;
    expect(confirmParent(snapshot, turn, cards)).toBe(snapshot.transcript);
  });
  it('admits a direct zero-task parent answer', () => {
    const snapshot = {
      ...healthy(),
      subagents: [],
      transcript: [human, healthy().transcript[3]],
    };
    expect(confirmParent(snapshot, turn, [])).toBe(snapshot.transcript);
  });
  it('retains a full previous native prefix without requiring old children in the current lifecycle', () => {
    const before = healthy();
    const oldCards = observeChildren(before, [], new Set()).cards;
    const nextHuman = {
      id: 'next-human',
      role: 'user' as const,
      content: 'Summarize.',
    };
    const next: NativeSnapshot = {
      ...before,
      subagents: [],
      run: {
        ...before.run!,
        id: 'next-run',
        terminal: {
          type: EventType.RUN_FINISHED,
          threadId: 'thread',
          runId: 'next-run',
        },
      },
      transcript: [
        ...before.transcript,
        nextHuman,
        {
          id: 'next-answer',
          role: 'assistant' as const,
          content: 'A direct follow-up.',
        },
      ],
    };
    expect(
      confirmParent(
        next,
        {
          ...turn,
          runId: 'next-run',
          prefix: before.transcript,
          human: nextHuman,
        },
        oldCards
      )
    ).toBe(next.transcript);
    const changed = {
      ...next,
      transcript: next.transcript.map((message) =>
        message.id === 'human' && message.role === 'user'
          ? { ...message, content: 'Changed retained question.' }
          : message
      ),
    };
    expect(
      confirmParent(
        changed,
        {
          ...turn,
          runId: 'next-run',
          prefix: before.transcript,
          human: nextHuman,
        },
        oldCards
      )
    ).toBeUndefined();
  });
  it.each([
    'running',
    'unsettled',
    'wrong run',
    'wrong thread',
    'cancelled',
    'legacy notice',
    'decision',
    'missing child',
    'child unfinished',
    'empty child',
    'orphan child',
    'missing result',
    'random result ID',
    'duplicate result',
    'changed parent',
    'unknown role',
    'unknown tool',
    'empty answer',
    'foreign human',
    'child in canonical history',
  ])('does not admit %s', (mode) => {
    let snapshot: NativeSnapshot = healthy();
    const cards = observeChildren(snapshot, [], new Set()).cards;
    if (mode === 'running') snapshot = { ...snapshot, status: 'running' };
    if (mode === 'unsettled')
      snapshot = { ...snapshot, run: { ...snapshot.run!, outcome: undefined } };
    if (mode === 'wrong run')
      snapshot = { ...snapshot, run: { ...snapshot.run!, id: 'other' } };
    if (mode === 'wrong thread')
      snapshot = {
        ...snapshot,
        run: {
          ...snapshot.run!,
          terminal: {
            type: EventType.RUN_FINISHED,
            runId: 'run',
            threadId: 'other',
          },
        },
      };
    if (mode === 'cancelled')
      snapshot = {
        ...snapshot,
        run: {
          ...snapshot.run!,
          terminal: {
            type: EventType.RUN_FINISHED,
            runId: 'run',
            threadId: 'thread',
            outcome: { type: 'cancelled' },
          },
        },
      };
    if (mode === 'legacy notice')
      snapshot = {
        ...snapshot,
        run: {
          ...snapshot.run!,
          legacyInterrupt: {
            type: EventType.CUSTOM,
            name: 'on_interrupt',
            value: {},
          },
        },
      };
    if (mode === 'decision')
      snapshot = {
        ...snapshot,
        decision: { kind: 'unsupported', sourceRunId: 'run' },
      };
    if (mode === 'missing child') snapshot = { ...snapshot, subagents: [] };
    if (mode === 'child unfinished')
      snapshot = {
        ...snapshot,
        subagents: snapshot.subagents.map((child) => ({
          started: child.started,
        })),
      };
    if (mode === 'empty child')
      snapshot = {
        ...snapshot,
        transcript: snapshot.transcript.map((message) =>
          message.role === 'tool' ? { ...message, content: '' } : message
        ),
      };
    if (mode === 'orphan child')
      snapshot = {
        ...snapshot,
        subagents: snapshot.subagents.map((child) => ({
          ...child,
          started: { ...child.started, parentToolCallId: 'foreign' },
        })),
      };
    if (mode === 'missing result')
      snapshot = {
        ...snapshot,
        transcript: snapshot.transcript.filter(
          (message) => message.role !== 'tool'
        ),
      };
    if (mode === 'random result ID')
      snapshot = {
        ...snapshot,
        transcript: snapshot.transcript.map((message) =>
          message.role === 'tool' ? { ...message, id: 'random' } : message
        ),
      };
    if (mode === 'duplicate result')
      snapshot = {
        ...snapshot,
        transcript: [...snapshot.transcript, snapshot.transcript[2]],
      };
    if (mode === 'changed parent')
      snapshot = {
        ...snapshot,
        transcript: snapshot.transcript.map((message) =>
          message.id === 'owner' ? { ...message, id: 'other-owner' } : message
        ),
      };
    if (mode === 'unknown role' || mode === 'unknown tool')
      snapshot = {
        ...snapshot,
        transcript: snapshot.transcript.map((message) =>
          message.role === 'assistant' && message.toolCalls
            ? {
                ...message,
                toolCalls: message.toolCalls.map((call) => ({
                  ...call,
                  function: {
                    name: mode === 'unknown tool' ? 'other_tool' : 'task',
                    arguments: JSON.stringify({
                      role: 'unknown',
                      task_description: 'A trip.',
                    }),
                  },
                })),
              }
            : message
        ),
      };
    if (mode === 'empty answer')
      snapshot = {
        ...snapshot,
        transcript: snapshot.transcript.map((message) =>
          message.id === 'answer' && message.role === 'assistant'
            ? { ...message, content: '' }
            : message
        ),
      };
    if (mode === 'foreign human')
      snapshot = {
        ...snapshot,
        transcript: snapshot.transcript.map((message) =>
          message.id === 'human' && message.role === 'user'
            ? { ...message, content: 'Different question.' }
            : message
        ),
      };
    if (mode === 'child in canonical history')
      snapshot = {
        ...snapshot,
        transcript: [
          ...snapshot.transcript,
          {
            id: 'child',
            role: 'assistant',
            content: 'Child answer.',
            subagentRunId: 'call-sub',
          },
        ],
      };
    expect(confirmParent(snapshot, turn, cards)).toBeUndefined();
  });
});
