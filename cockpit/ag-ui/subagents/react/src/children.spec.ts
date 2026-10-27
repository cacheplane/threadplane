import { describe, expect, it } from 'vitest';
import { EventType } from '@ag-ui/core';
import { observeChildren, type NativeSnapshot } from './children';

function native(text = 'A specialist answer.'): NativeSnapshot {
  return {
    status: 'running',
    state: {},
    run: { id: 'root-run' },
    transcript: [
      { id: 'human', role: 'user', content: 'Plan a fictional trip.' },
      {
        id: 'assistant',
        role: 'assistant',
        content: '',
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
        id: 'call-sub-m1',
        role: 'assistant',
        content: text,
        subagentRunId: 'call-sub',
      },
    ],
    subagents: [
      {
        started: {
          type: EventType.SUBAGENT_STARTED,
          subagentRunId: 'call-sub',
          name: 'research',
          parentToolCallId: 'call',
        },
      },
    ],
  };
}
function finished(source = native()): NativeSnapshot {
  return {
    ...source,
    transcript: source.transcript
      .filter((message) => !message.subagentRunId)
      .concat([
        {
          id: 'call',
          role: 'tool',
          toolCallId: 'call',
          content: 'A specialist answer.',
        },
      ]),
    subagents: source.subagents.map((child) => ({
      ...child,
      terminal: {
        type: EventType.SUBAGENT_FINISHED,
        subagentRunId: child.started.subagentRunId,
        outcome: { type: 'success' },
      },
    })),
  };
}
describe('read-only observed child display', () => {
  it('observes a known child while root arguments and its first text are not yet published', () => {
    const source = native();
    const snapshot: NativeSnapshot = {
      ...source,
      transcript: source.transcript.map((message) =>
        message.id === 'assistant' && message.role === 'assistant'
          ? {
              ...message,
              toolCalls: message.toolCalls?.map((call) => ({
                ...call,
                function: { ...call.function, arguments: '' },
              })),
            }
          : message.id === 'call-sub-m1' && message.role === 'assistant'
          ? { ...message, content: undefined }
          : message
      ),
    };
    const selected = observeChildren(snapshot, [], new Set());
    expect(selected.unsupported).toBe(false);
    expect(selected.cards[0].role).toBe('research');
    expect(selected.cards[0].messages).toEqual([
      { id: 'call-sub-m1', text: '' },
    ]);
    expect(
      observeChildren(
        { ...snapshot, status: 'idle' },
        selected.cards,
        new Set()
      ).unsupported
    ).toBe(true);
  });
  it('copies live attributed text under its exact assistant and parent task', () => {
    const source = native();
    const selected = observeChildren(source, [], new Set());
    expect(selected.unsupported).toBe(false);
    expect(selected.cards).toEqual([
      {
        id: 'call-sub',
        runId: 'root-run',
        ownerId: 'assistant',
        callId: 'call',
        role: 'research',
        phase: 'running',
        messages: [{ id: 'call-sub-m1', text: 'A specialist answer.' }],
        answer: null,
      },
    ]);
    expect(Object.isFrozen(selected.cards)).toBe(true);
    expect(Object.isFrozen(selected.cards[0].messages[0])).toBe(true);
    expect(Object.isFrozen(source)).toBe(false);
  });
  it('retains observed text after the actual final snapshot removes child messages', () => {
    const before = observeChildren(native(), [], new Set());
    const after = observeChildren(finished(), before.cards, new Set());
    expect(after.unsupported).toBe(false);
    expect(after.cards[0].messages).toEqual(before.cards[0].messages);
    expect(after.cards[0].answer).toBe('A specialist answer.');
    expect(after.cards[0].phase).toBe('complete');
  });
  it('keeps prior cards when the native lifecycle resets for a later root run', () => {
    const before = observeChildren(finished(), [], new Set());
    const source = { ...finished(), run: { id: 'next-run' }, subagents: [] };
    const after = observeChildren(source, before.cards, new Set(['call']));
    expect(after.cards).toEqual(before.cards);
  });
  it('supports a completed child with no token observations through its causal task result', () => {
    const selected = observeChildren(finished(), [], new Set());
    expect(selected.cards[0].messages).toEqual([]);
    expect(selected.cards[0].answer).toBe('A specialist answer.');
  });
  it('uses the causal final result after a blank child start receives no text', () => {
    const before = observeChildren(native(''), [], new Set());
    const after = observeChildren(finished(), before.cards, new Set());
    expect(after.unsupported).toBe(false);
    expect(after.cards[0].phase).toBe('complete');
    expect(after.cards[0].answer).toBe('A specialist answer.');
  });
  it('copies no raw child error, code or metadata into display data', () => {
    const source = native();
    const terminal = {
      type: EventType.SUBAGENT_ERROR as const,
      subagentRunId: 'call-sub',
      message: 'private-provider-marker-14',
      code: 'private-code',
      metadata: { private: 'private-metadata' },
    };
    Object.defineProperty(terminal, 'message', {
      get() {
        throw new Error('Private field must not be read');
      },
    });
    const selected = observeChildren(
      { ...source, subagents: [{ ...source.subagents[0], terminal }] },
      [],
      new Set()
    );
    expect(selected.unsupported).toBe(true);
    expect(selected.cards[0].phase).toBe('error');
    expect(JSON.stringify(selected)).not.toMatch(
      /private-provider|private-code|private-metadata/
    );
  });
  it.each([
    'wrong parent',
    'wrong identity',
    'wrong role',
    'nested child',
    'duplicate child',
    'foreign current call',
    'failed outcome',
    'oversize text',
    'changed result',
  ])('rejects %s without inventing child authority', (mode) => {
    const source = native();
    const child = {
      ...source.subagents[0],
      started: { ...source.subagents[0].started },
    };
    let value: NativeSnapshot = { ...source, subagents: [child] };
    const prior =
      mode === 'foreign current call' ? new Set(['call']) : new Set<string>();
    if (mode === 'wrong parent') child.started.parentToolCallId = 'missing';
    if (mode === 'wrong identity') child.started.subagentRunId = 'wrong';
    if (mode === 'wrong role') child.started.name = 'unknown';
    if (mode === 'nested child') child.started.parentSubagentRunId = 'nested';
    if (mode === 'duplicate child')
      value = { ...value, subagents: [child, child] };
    if (mode === 'failed outcome')
      value = {
        ...value,
        subagents: [
          {
            ...child,
            terminal: {
              type: EventType.SUBAGENT_FINISHED,
              subagentRunId: 'call-sub',
              outcome: { type: 'suspended' },
            },
          },
        ],
      };
    if (mode === 'oversize text') value = native('x'.repeat(65_537));
    const before =
      mode === 'changed result'
        ? observeChildren(native(), [], new Set()).cards
        : [];
    if (mode === 'changed result')
      value = {
        ...finished(),
        transcript: finished().transcript.map((message) =>
          message.role === 'tool'
            ? { ...message, content: 'Different answer.' }
            : message
        ),
      };
    expect(observeChildren(value, before, prior).unsupported).toBe(true);
  });
});
