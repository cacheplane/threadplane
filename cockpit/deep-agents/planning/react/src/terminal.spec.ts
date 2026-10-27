import { describe, expect, it } from 'vitest';
import { staticDelivery, type Message } from '@threadplane/core';
import { captureBaseline, captureTerminal, captureTurn } from './terminal';

const todos = [{ content: 'Unfinished', status: 'in_progress' }];
const ref = { thread_id: 'thread', checkpoint_ns: '', checkpoint_id: 'cp' };
const identity = {
  owner: 'owner',
  generation: 'local-generation',
  threadId: 'thread',
  humanId: 'human',
  humanContent: 'Plan',
};
function example(write = true, items = todos) {
  const calls = write
    ? [
        {
          id: 'call',
          name: 'write_todos',
          args: { todos: items },
          type: 'tool_call',
        },
      ]
    : [];
  const messages: {
    id: string;
    type: string;
    name: string | null;
    content: string;
    tool_calls?: typeof calls;
    invalid_tool_calls?: unknown[];
    tool_call_id?: string;
    status?: string;
  }[] = [
    { id: 'human', type: 'human', name: null, content: 'Plan' },
    ...(write
      ? [
          {
            id: 'ai',
            type: 'ai',
            name: null,
            content: '',
            tool_calls: calls,
            invalid_tool_calls: [],
          },
          {
            id: 'tool',
            type: 'tool',
            name: 'write_todos',
            content: 'Python repr prose',
            tool_call_id: 'call',
            status: 'success',
          },
        ]
      : []),
    {
      id: 'answer',
      type: 'ai',
      name: null,
      content: 'Here is the answer',
      tool_calls: [],
      invalid_tool_calls: [],
    },
  ];
  const values = { messages, files: {}, todos: items };
  const raw = {
    checkpoint: ref,
    values,
    metadata: { source: 'loop', step: 4, parents: {} },
    next: [],
    tasks: [],
  };
  const projected = messages.map((m) => ({
    id: m.id,
    role: (m.type === 'human'
      ? 'user'
      : m.type === 'ai'
      ? 'assistant'
      : 'tool') as Message['role'],
    content: m.content,
    delivery: staticDelivery(m.id),
    ...(m.name ? { name: m.name } : {}),
    ...('tool_call_id' in m ? { toolCallId: m.tool_call_id } : {}),
    ...('tool_calls' in m
      ? { toolCallIds: m.tool_calls?.map((c) => c.id) }
      : {}),
  }));
  const input = {
    turn: captureTurn(
      captureBaseline({
        messages: [],
        files: {},
        ...(write ? {} : { todos: items }),
      }),
      identity
    ),
    owner: 'owner',
    generation: 'local-generation',
    threadId: 'thread',
    submittedSuccessfully: true,
    observedCheckpoint: ref,
    observedValues: values,
    loadedCheckpoint: raw,
    snapshot: {
      status: 'idle',
      interrupts: [],
      subgraphs: [],
      messages: projected,
      toolCalls: calls.map((c) => ({
        id: c.id,
        name: c.name,
        args: c.args,
        status: 'complete' as const,
        result: 'Python repr prose',
      })),
      values: { files: {}, todos: items },
      history: [raw],
    },
  };
  return input;
}
describe('owned terminal saved plan', () => {
  it('captures an inert first-turn baseline without saved-state fields', () => {
    expect(captureBaseline(undefined)).toEqual({
      messages: [],
      plan: { kind: 'missing' },
    });
  });
  it('accepts optional undefined native fields while raw data stays JSON-only', () => {
    const input = example();
    Object.assign(input.snapshot, { error: undefined });
    Object.assign(input.snapshot.messages[0], {
      name: undefined,
      reasoning: undefined,
      citations: undefined,
    });
    expect(captureTerminal(input).kind).toBe('confirmed');
  });
  it('accepts the actual compact native history entry without raw values/tasks', () => {
    const input = example();
    const history = [
      {
        checkpoint: ref,
        parent_checkpoint: null,
        created_at: '2026-10-10T00:43:51Z',
        next: [],
      },
    ];
    expect(
      captureTerminal({ ...input, snapshot: { ...input.snapshot, history } })
        .kind
    ).toBe('confirmed');
  });
  it('confirms actual state with unfinished todos and no run metadata', () => {
    const result = captureTerminal(example());
    expect(result.kind).toBe('confirmed');
    if (result.kind !== 'confirmed') throw new Error('Expected confirmation');
    expect(result.plan).toEqual({ kind: 'valid', items: todos });
    expect(result.update).toBe('replacement');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.values.messages)).toBe(true);
  });
  it('confirms valid empty clear', () => {
    expect(captureTerminal(example(true, []))).toMatchObject({
      plan: { kind: 'valid', items: [] },
    });
  });
  it('retains consistent baseline on a no-write response', () => {
    expect(captureTerminal(example(false))).toMatchObject({
      update: 'retained',
    });
  });
  it('allows a missing plan on a first no-write response', () => {
    const input = example(false);
    input.turn = captureTurn(
      captureBaseline({ messages: [], files: {} }),
      identity
    );
    for (const values of [
      input.observedValues,
      input.loadedCheckpoint.values,
      input.snapshot.values,
    ])
      delete (values as { todos?: unknown }).todos;
    expect(captureTerminal(input)).toMatchObject({ plan: { kind: 'missing' } });
  });
  it('captures immutable baseline without mount I/O, then binds actual human id', () => {
    const source = { messages: [], todos };
    const baseline = captureBaseline(source);
    const turn = captureTurn(baseline, identity);
    if (!turn || turn.baseline.plan.kind !== 'valid')
      throw new Error('Expected valid turn');
    expect(turn.baseline.plan.items).toEqual(todos);
    expect(Object.isFrozen(turn.baseline)).toBe(true);
    expect(turn.humanId).toBe('human');
    expect(captureBaseline({ messages: [], todos: null })).toBeUndefined();
  });
  it.each(['owner', 'generation', 'threadId'])('rejects foreign %s', (key) => {
    const input = example();
    expect(captureTerminal({ ...input, [key]: 'foreign' }).kind).toBe(
      'unconfirmed'
    );
  });
  it('requires a successful native submission', () => {
    expect(
      captureTerminal({ ...example(), submittedSuccessfully: false }).kind
    ).toBe('unconfirmed');
  });
  it('never coerces a nonboolean submission outcome into success', () => {
    expect(
      captureTerminal({
        ...example(),
        submittedSuccessfully: 'true' as unknown as boolean,
      }).kind
    ).toBe('unconfirmed');
  });
  it('confirms a recovered replacement after raw nameless parallel errors', () => {
    const input = example();
    const rejected = ['a', 'b'].map((id) => ({
      id,
      name: 'write_todos',
      args: { todos },
      type: 'tool_call',
    }));
    const text = 'Error: never call write_todos multiple times in parallel';
    const rawErrors = [
      {
        id: 'parallel-ai',
        type: 'ai',
        name: null,
        content: '',
        tool_calls: rejected,
        invalid_tool_calls: [],
      },
      ...rejected.map((call) => ({
        id: `error-${call.id}`,
        type: 'tool',
        name: null,
        content: text,
        tool_call_id: call.id,
        status: 'error',
      })),
    ];
    input.loadedCheckpoint.values.messages.splice(1, 0, ...rawErrors);
    input.snapshot.messages.splice(
      1,
      0,
      {
        id: 'parallel-ai',
        role: 'assistant',
        content: '',
        delivery: staticDelivery('parallel-ai'),
        toolCallIds: ['a', 'b'],
      },
      ...rejected.map((call) => ({
        id: `error-${call.id}`,
        role: 'tool' as const,
        content: text,
        delivery: staticDelivery(`error-${call.id}`),
        toolCallId: call.id,
      }))
    );
    input.snapshot.toolCalls.unshift(
      ...rejected.map((call) => ({
        id: call.id,
        name: call.name,
        args: call.args,
        status: 'complete' as const,
        result: text,
      }))
    );
    expect(captureTerminal(input)).toMatchObject({
      kind: 'confirmed',
      update: 'replacement',
      plan: { kind: 'valid', items: todos },
    });
  });
  it('retains prior saved plan with an unchanged baseline canonical prefix', () => {
    const input = example(false);
    const prefix = [
      {
        id: 'old-human',
        type: 'human',
        name: null,
        content: 'Earlier request',
      },
      {
        id: 'old-answer',
        type: 'ai',
        name: null,
        content: 'Earlier response',
        tool_calls: [],
        invalid_tool_calls: [],
      },
    ];
    input.loadedCheckpoint.values.messages.unshift(...prefix);
    input.snapshot.messages.unshift(
      ...prefix.map((message) => ({
        id: message.id,
        role: (message.type === 'human'
          ? 'user'
          : 'assistant') as Message['role'],
        content: message.content,
        delivery: staticDelivery(message.id),
        ...(message.type === 'ai' ? { toolCallIds: [] } : {}),
      }))
    );
    input.turn = captureTurn(
      captureBaseline({ messages: prefix, todos }),
      identity
    );
    expect(captureTerminal(input)).toMatchObject({
      kind: 'confirmed',
      update: 'retained',
      plan: { kind: 'valid', items: todos },
    });
  });
  it('recovers on a later send using current canonical prefix and separate saved authority', () => {
    const input = example();
    const prefix = [
      {
        id: 'failed-human',
        type: 'human',
        name: null,
        content: 'Previous attempt',
      },
      {
        id: 'failed-answer',
        type: 'ai',
        name: null,
        content: 'Unconfirmed previous answer',
        tool_calls: [],
        invalid_tool_calls: [],
      },
    ];
    input.loadedCheckpoint.values.messages.unshift(...prefix);
    input.snapshot.messages.unshift(
      ...prefix.map((m) => ({
        id: m.id,
        role: (m.type === 'human' ? 'user' : 'assistant') as Message['role'],
        content: m.content,
        delivery: staticDelivery(m.id),
        ...(m.type === 'ai' ? { toolCallIds: [] } : {}),
      }))
    );
    const baseline = captureBaseline(
      {
        messages: prefix,
        todos: [{ content: 'Malformed observation', status: 'unknown' }],
      },
      { kind: 'missing' }
    );
    expect(baseline).toMatchObject({ plan: { kind: 'missing' } });
    input.turn = captureTurn(baseline, identity);
    expect(captureTerminal(input)).toMatchObject({
      kind: 'confirmed',
      update: 'replacement',
      plan: { kind: 'valid', items: todos },
    });
  });
  it('does not adopt changed unconfirmed state through a no-write baseline', () => {
    const input = example(false);
    input.turn = captureTurn(
      captureBaseline({ messages: [], todos }, { kind: 'valid', items: [] }),
      identity
    );
    expect(captureTerminal(input).kind).toBe('unconfirmed');
  });
  it('validates and immutably captures explicit retained authority', () => {
    const saved = {
      kind: 'valid' as const,
      items: [{ content: 'Saved', status: 'pending' as const }],
    };
    const baseline = captureBaseline({ messages: [], todos: null }, saved);
    expect(baseline).toMatchObject({ plan: saved });
    saved.items[0].content = 'Mutated';
    expect(baseline).toMatchObject({
      plan: { kind: 'valid', items: [{ content: 'Saved', status: 'pending' }] },
    });
    expect(
      captureBaseline({ messages: [] }, {
        kind: 'valid',
        items: [{ content: 'bad', status: 'invented' }],
      } as never)
    ).toBeUndefined();
  });
  it.each(['next', 'tasks', 'interrupts', '__interrupt__', 'subgraphs'])(
    'rejects unresolved execution %s',
    (key) => {
      const input = example();
      expect(
        captureTerminal({
          ...input,
          loadedCheckpoint: {
            ...input.loadedCheckpoint,
            [key]: [{ id: 'pending' }],
          },
        }).kind
      ).toBe('unconfirmed');
    }
  );
  it('rejects raw errors and nonidle native states', () => {
    const input = example();
    expect(
      captureTerminal({
        ...input,
        loadedCheckpoint: { ...input.loadedCheckpoint, error: 'bad' },
      }).kind
    ).toBe('unconfirmed');
    expect(
      captureTerminal({
        ...input,
        snapshot: { ...input.snapshot, status: 'running' },
      }).kind
    ).toBe('unconfirmed');
  });
  it('compares backend run metadata only with actual known backend id', () => {
    const input = example();
    input.loadedCheckpoint.metadata = {
      ...input.loadedCheckpoint.metadata,
      run_id: 'backend',
    } as typeof input.loadedCheckpoint.metadata;
    expect(captureTerminal({ ...input, backendRunId: 'backend' }).kind).toBe(
      'confirmed'
    );
    expect(captureTerminal({ ...input, backendRunId: 'foreign' }).kind).toBe(
      'unconfirmed'
    );
    expect(captureTerminal(input).kind).toBe('confirmed');
  });
  it('rejects checkpoint namespaces, foreign thread and mismatched exact checkpoint', () => {
    for (const changed of [
      { checkpoint_ns: 'subgraph' },
      { thread_id: 'foreign' },
      { checkpoint_id: 'other' },
    ]) {
      const input = example();
      expect(
        captureTerminal({
          ...input,
          observedCheckpoint: { ...ref, ...changed },
        }).kind
      ).toBe('unconfirmed');
    }
  });
  it('rejects history or observed values that differ from exact loaded state', () => {
    const input = example();
    expect(
      captureTerminal({
        ...input,
        observedValues: { ...input.observedValues, todos: [] },
      }).kind
    ).toBe('unconfirmed');
    expect(
      captureTerminal({
        ...input,
        snapshot: {
          ...input.snapshot,
          history: [
            {
              ...input.loadedCheckpoint,
              values: { ...input.observedValues, todos: [] },
            },
          ],
        },
      }).kind
    ).toBe('unconfirmed');
  });
  it.each(['id', 'role', 'content', 'toolCallId'])(
    'requires canonical projected message %s parity',
    (key) => {
      const input = example();
      input.snapshot.messages[2] = {
        ...input.snapshot.messages[2],
        [key]: 'foreign',
      } as (typeof input.snapshot.messages)[number];
      expect(captureTerminal(input).kind).toBe('unconfirmed');
    }
  );
  it('rejects changed call arguments/result data despite projected complete', () => {
    const input = example();
    input.snapshot.toolCalls[0].result = 'Different';
    expect(captureTerminal(input).kind).toBe('unconfirmed');
  });
  it('does not promote a rejected write even when core projects complete', () => {
    const input = example();
    Object.assign(input.loadedCheckpoint.values.messages[2], {
      status: 'error',
    });
    expect(captureTerminal(input).kind).toBe('unconfirmed');
  });
  it('rejects external plan changes on no-write turns', () => {
    const input = example(false);
    input.turn = captureTurn(
      captureBaseline({ messages: [], todos: [] }),
      identity
    );
    expect(captureTerminal(input).kind).toBe('unconfirmed');
  });
  it('rejects changed baseline transcript or human content', () => {
    const input = example();
    input.turn = captureTurn(
      captureBaseline({
        messages: [{ id: 'old', type: 'human', content: 'old' }],
      }),
      identity
    );
    expect(captureTerminal(input).kind).toBe('unconfirmed');
    expect(
      captureTerminal({
        ...example(),
        turn: captureTurn(captureBaseline({ messages: [] }), {
          ...identity,
          humanContent: 'different',
        }),
      }).kind
    ).toBe('unconfirmed');
  });
});
