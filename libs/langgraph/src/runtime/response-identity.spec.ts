import type { ThreadState } from '@langchain/langgraph-sdk';
import type { AgentTransport } from './transport.types';
import { controlledSession } from './testing/controlled-session';
import { createSession } from './create-session';
import { rebaseRun } from './run-recovery';
import { describe, expect, it, vi } from 'vitest';
import { initialMessageState, reduceMessages } from './message-reducer';
import {
  finalizeProjection,
  projectStream,
  type StreamProjection,
} from './stream-projection';
import type { StreamEvent } from './transport.types';
import { initialSubgraphs, projectSubgraphs } from './subgraph-projection';

const projection = (): StreamProjection => ({
  generation: 'physical-run',
  baselineIds: [],
  sawAssistant: false,
  terminal: false,
  paused: false,
  canonical: [],
});
const chunk = (id: string, content: unknown[]): StreamEvent => ({
  type: 'messages',
  messageMetadata: { langgraph_node: 'generate', langgraph_step: 3 },
  messages: [
    {
      type: 'AIMessageChunk',
      id,
      content,
      response_metadata: { model_provider: 'openai' },
    },
  ],
});
const full = (id: string, content: unknown[], extra = {}) => ({
  type: 'ai',
  id,
  content,
  response_metadata: { model_provider: 'openai', id },
  ...extra,
});
function replay(events: StreamEvent[]) {
  let current = { state: initialMessageState(), projection: projection() };
  for (const event of events)
    current = projectStream(current.state, current.projection, event);
  return {
    ...current,
    state: finalizeProjection(current.state, current.projection),
  };
}

describe('captured OpenAI response item identity', () => {
  // Shapes from the real pinned Python provider capture: response.created has
  // the provider ID; following chunks have the LangChain callback ID. Only the
  // text-done chunk carries the output-item ID also present in final values.
  it('reconciles captured text chunks to the saved response rather than duplicating a live row', () => {
    const canonical = 'resp-3gPH4_Lz_wgLoxP0';
    const provisional = 'lc_run--01a0ecc9-3db6-7730-8541-f7dd17b0ef36';
    const text = 'The checkpoint result above records the human decision.';
    const current = replay([
      chunk(canonical, []),
      chunk(provisional, []),
      chunk(provisional, [{ type: 'text', text, index: 0 }]),
      chunk(provisional, [
        { type: 'text', text: '', id: 'msg-a1BfBC9AGz43Ab6h', index: 0 },
      ]),
      chunk(provisional, []),
      {
        type: 'values',
        data: {
          messages: [
            full(
              canonical,
              [{ type: 'text', text, index: 0, id: 'msg-a1BfBC9AGz43Ab6h' }],
              { tool_calls: [] }
            ),
          ],
        },
      },
    ]);
    expect(current.state.messages.map((m) => [m.id, m.content])).toEqual([
      [canonical, text],
    ]);
    expect(current.projection.currentAssistantId).toBe(canonical);
  });

  it('reconciles captured function chunks without admitting a second tool call', () => {
    const canonical = 'resp-l0iXKGYmfBYOY19F';
    const provisional = 'lc_run--01a0ecc9-3874-7c43-9cfb-4f3be8045f9a';
    const item = {
      type: 'function_call',
      name: 'delete_backups',
      call_id: 'call_L0IMW3_JEXIOaZLL',
      id: 'fc-MAJ7MV1nQl0nRqUN',
      index: 0,
    };
    const current = replay([
      chunk(canonical, []),
      chunk(provisional, [{ ...item, arguments: '' }]),
      chunk(provisional, [
        {
          type: 'function_call',
          arguments: '{"ids":["proof-delete"]}',
          index: 0,
        },
      ]),
      chunk(provisional, []),
      {
        type: 'values',
        data: {
          messages: [
            full(
              canonical,
              [{ ...item, arguments: '{"ids":["proof-delete"]}' }],
              {
                tool_calls: [
                  {
                    id: item.call_id,
                    name: item.name,
                    args: { ids: ['proof-delete'] },
                  },
                ],
              }
            ),
          ],
        },
      },
    ]);
    expect(current.state.messages.map((m) => m.id)).toEqual([canonical]);
    expect(current.state.messages[0].toolCallIds).toEqual([item.call_id]);
    expect(current.state.toolCalls.map((c) => c.id)).toEqual([item.call_id]);
    expect(current.projection.toolAssistantIds).toEqual([canonical]);
  });
});

const textItem = (id = 'item', text = 'A', index = 0) => ({
  type: 'text',
  id,
  text,
  index,
});
const values = (...messages: unknown[]): StreamEvent => ({
  type: 'values',
  data: { messages },
});
const open = (extra: unknown[] = []) => [
  chunk('canonical', []),
  chunk('provisional', [textItem(), ...extra]),
];

describe('explicit identity isolation', () => {
  it.each([
    ['missing item', [{ type: 'text', text: 'A', index: 0 }]],
    [
      'unresolved second item',
      [textItem(), { type: 'text', text: 'B', index: 1 }],
    ],
    [
      'unsupported block',
      [textItem(), { type: 'image', id: 'image', index: 1 }],
    ],
    ['conflicting index identity', [textItem(), textItem('other')]],
    [
      'conflicting index type',
      [
        textItem(),
        { type: 'function_call', id: 'item', call_id: 'call', index: 0 },
      ],
    ],
    ['same item at two indexes', [textItem(), textItem('item', 'A', 1)]],
  ] as const)(
    'rejects %s rather than matching a valid subset',
    (_name, blocks) => {
      const current = replay([
        chunk('provisional', [...blocks]),
        values(full('canonical', [textItem()])),
      ]);
      expect(current.state.messages.map((m) => m.id)).toEqual([
        'provisional',
        'canonical',
      ]);
    }
  );

  it.each(['same text', 'A', ''])(
    'does not correlate distinct text %j without item evidence',
    (text) => {
      const current = replay([
        chunk('first', [{ type: 'text', text, index: 0 }]),
        values(full('second', [{ type: 'text', text }])),
      ]);
      expect(current.state.messages.map((m) => m.id)).toEqual([
        'first',
        'second',
      ]);
    }
  );

  it.each([
    ['competing full owner', full('other', [textItem()])],
    [
      'competing incomplete owner',
      full('other', [textItem(), { type: 'image', id: 'image' }]),
    ],
    [
      'competing unresolved owner',
      full('other', [textItem(), { type: 'text', text: 'unidentified' }]),
    ],
  ])('rejects %s anywhere in the terminal batch', (_name, other) => {
    for (const batch of [
      [full('canonical', [textItem()]), other],
      [other, full('canonical', [textItem()])],
    ]) {
      const current = replay([...open(), values(...batch)]);
      expect(current.state.messages.map((m) => m.id)).toContain('provisional');
    }
  });

  it('rejects competing provisional owners and does not borrow same-node metadata', () => {
    const current = replay([
      ...open(),
      chunk('other', [textItem()]),
      values(full('canonical', [textItem()])),
    ]);
    expect(current.state.messages.map((m) => m.id)).toEqual([
      'canonical',
      'provisional',
      'other',
    ]);
    const distinct = replay([
      ...open(),
      chunk('other', [textItem('different')]),
      values(
        full('canonical', [textItem()]),
        full('other-canonical', [textItem('different')])
      ),
    ]);
    expect(distinct.state.messages.map((m) => m.id)).toEqual([
      'canonical',
      'other-canonical',
    ]);
  });

  it('does not accept other providers or missing/mismatched response IDs', () => {
    for (const metadata of [
      { model_provider: 'other', id: 'canonical' },
      { model_provider: 'openai' },
      { model_provider: 'openai', id: 'different' },
    ]) {
      const current = replay([
        ...open(),
        values({
          ...full('canonical', [textItem()]),
          response_metadata: metadata,
        }),
      ]);
      expect(current.state.messages.map((m) => m.id)).toContain('provisional');
    }
  });

  it.each(['provisional', 'canonical', 'other'])(
    'does not bind baseline %s or its competing canonical claim',
    (baseline) => {
      let current = {
        state: initialMessageState(),
        projection: {
          ...projection(),
          baselineIds: [baseline] as readonly string[],
        },
      };
      for (const event of [
        ...open(),
        values(
          full('canonical', [textItem()]),
          ...(baseline === 'other' ? [full('other', [textItem()])] : [])
        ),
      ])
        current = projectStream(current.state, current.projection, event);
      expect(current.state.messages.map((m) => m.id)).toContain('provisional');
    }
  );

  it.each(['Short', ''])(
    'installs exact canonical %j with citations/reasoning, preserving unrelated rows',
    (text) => {
      const current = replay([
        values({ type: 'ai', id: 'earlier', content: 'Earlier' }),
        ...open(),
        values(
          full('canonical', [textItem('item', text)], {
            reasoning: 'Reason',
            additional_kwargs: { citations: [{ title: 'Source' }] },
          })
        ),
      ]);
      expect(current.state.messages.map((m) => [m.id, m.content])).toEqual([
        ['earlier', 'Earlier'],
        ['canonical', text],
      ]);
      expect(current.state.messages[1]).toMatchObject({
        reasoning: 'Reason',
        citations: [{ title: 'Source' }],
      });
      const late = projectStream(
        current.state,
        current.projection,
        chunk('provisional', [textItem('item', 'Late')])
      );
      expect(late.state.messages).toBe(current.state.messages);
    }
  );

  it('keeps values interim: aliased chunks can continue before finalization', () => {
    let current = { state: initialMessageState(), projection: projection() };
    for (const event of [...open(), values(full('canonical', [textItem()]))])
      current = projectStream(current.state, current.projection, event);
    expect(current.state.messages[0].delivery.phase).toBe('streaming');
    current = projectStream(
      current.state,
      current.projection,
      chunk('provisional', [textItem('item', 'B')])
    );
    expect(current.state.messages.map((m) => [m.id, m.content])).toEqual([
      ['canonical', 'AB'],
    ]);
    expect(current.projection.terminal).toBe(false);
    expect(current.projection.canonical).toEqual([]);
  });

  it('does not let namespace frames establish root evidence', () => {
    const current = replay([
      { ...chunk('provisional', [textItem()]), namespace: ['child'] },
      values(full('canonical', [textItem()])),
    ]);
    expect(current.projection.responseIdentity?.aliases).toEqual([]);
  });

  it('keeps retained snapshots immutable and repeated canonical claims idempotent', () => {
    const first = replay(open());
    const before = first.state.messages;
    const event = values(full('canonical', [textItem()]));
    const next = projectStream(first.state, first.projection, event);
    const repeated = projectStream(next.state, next.projection, event);
    expect(before.map((m) => m.id)).toEqual(['canonical', 'provisional']);
    expect(repeated.state.messages.map((m) => m.id)).toEqual(['canonical']);
    expect(repeated.projection.responseIdentity?.aliases).toHaveLength(1);
  });
});

describe('identity lifetime and contradiction boundaries', () => {
  it('applies a repeated canonical owner correction in the same batch after the one-time merge', () => {
    let current = { state: initialMessageState(), projection: projection() };
    for (const event of [
      ...open(),
      values(
        full('canonical', [textItem()]),
        full('canonical', [textItem('item', 'A corrected')])
      ),
    ])
      current = projectStream(current.state, current.projection, event);
    expect(current.state.messages.map((m) => [m.id, m.content])).toEqual([
      ['canonical', 'A corrected'],
    ]);
  });

  it('requires the function item and call IDs to agree without accepting a subset', () => {
    const first = {
      type: 'function_call',
      index: 0,
      id: 'function',
      call_id: 'call',
    };
    for (const content of [
      [{ ...first, call_id: 'other' }],
      [first, { type: 'text', index: 1 }],
    ]) {
      const current = replay([
        chunk('provisional', [first]),
        values(full('canonical', content)),
      ]);
      expect(current.state.messages.map((m) => m.id)).toEqual([
        'provisional',
        'canonical',
      ]);
    }
    const current = replay([
      chunk('provisional', [first]),
      chunk('provisional', [{ ...first, call_id: 'changed' }]),
      values(full('canonical', [first])),
    ]);
    expect(current.state.messages.map((m) => m.id)).toEqual([
      'provisional',
      'canonical',
    ]);
  });

  it('retains observed canonical competing claims across batches and blocks later mappings after contradiction', () => {
    const current = replay([
      values(full('other', [textItem()])),
      ...open(),
      values(full('canonical', [textItem()])),
    ]);
    expect(current.state.messages.map((m) => m.id)).toContain('provisional');
    const bound = replay([...open(), values(full('canonical', [textItem()]))]);
    const conflicting = projectStream(
      bound.state,
      bound.projection,
      values(full('other', [textItem()]))
    );
    const newChunk = projectStream(
      conflicting.state,
      conflicting.projection,
      chunk('new', [textItem()])
    );
    const next = projectStream(
      newChunk.state,
      newChunk.projection,
      values(full('third', [textItem()]))
    );
    expect(next.projection.responseIdentity?.aliases).toEqual([
      { from: 'provisional', to: 'canonical' },
    ]);
    expect(next.state.messages.map((m) => m.id)).toContain('new');
  });

  it('resets evidence with a fresh physical projection even when prior messages remain', () => {
    const before = replay([chunk('provisional', [textItem()])]);
    const next = projectStream(
      before.state,
      { ...projection(), generation: 'new', baselineIds: ['provisional'] },
      values(full('canonical', [textItem()]))
    );
    expect(next.state.messages.map((m) => m.id)).toEqual([
      'provisional',
      'canonical',
    ]);
    expect(next.projection.responseIdentity?.aliases).toEqual([]);
  });
});

// Reconnection reuses physical evidence, while delivery generations change.

describe('response identity through session ownership', () => {
  it('preserves evidence across reconnect and rejects aliased deltas after actual finalization', () => {
    let current = replay([...open(), values(full('canonical', [textItem()]))]);
    current = {
      ...current,
      state: reduceMessages(current.state, {
        type: 'complete',
        generation: 'physical-run',
        outcome: 'interrupted',
      }),
    };
    const recovered = rebaseRun(
      current.state,
      current.projection,
      'joined-generation'
    );
    expect(recovered.projection.responseIdentity).toBe(
      current.projection.responseIdentity
    );
    const continued = projectStream(
      recovered.state,
      recovered.projection,
      chunk('provisional', [textItem('item', 'B')])
    );
    expect(continued.state.messages.map((m) => [m.id, m.content])).toEqual([
      ['canonical', 'AB'],
    ]);
    const terminal = projectStream(
      continued.state,
      continued.projection,
      values(full('canonical', [textItem('item', 'AB')]))
    );
    const finalized = finalizeProjection(terminal.state, terminal.projection);
    const late = projectStream(
      finalized,
      terminal.projection,
      chunk('provisional', [textItem('item', 'Late')])
    );
    expect(late.state.messages.map((m) => [m.id, m.content])).toEqual([
      ['canonical', 'AB'],
    ]);
  });

  it('admits a finalized correlated tool once despite duplicate final values', async () => {
    const item = {
      type: 'function_call',
      id: 'function',
      call_id: 'call',
      index: 0,
    };
    const final = full('canonical', [item], {
      tool_calls: [{ id: 'call', name: 'work', args: {} }],
    });
    const handler = vi.fn(() => 'Result');
    const updateState = vi.fn<NonNullable<AgentTransport['updateState']>>(
      async () => undefined
    );
    const stream = vi.fn<AgentTransport['stream']>(async function* () {
      yield chunk('canonical', []);
      yield chunk('provisional', [item]);
      expect(handler).not.toHaveBeenCalled();
      yield values(final);
      yield values(final);
    });
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: { stream, updateState },
      tools: { work: { description: 'Work', followUp: false, handler } },
    });
    await expect(session.submit('Work')).resolves.toBe('success');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(updateState).toHaveBeenCalledTimes(1);
    expect(
      session
        .getSnapshot()
        .messages.filter((m) => m.role === 'assistant')
        .map((m) => m.id)
    ).toEqual(['canonical']);
    await session.dispose();
  });

  it.each(['stop', 'dispose'] as const)(
    'does not publish retired alias frames after %s',
    async (command) => {
      const fixture = controlledSession();
      const pending = fixture.session.submit('First');
      await fixture.started();
      for (const event of [...open(), values(full('canonical', [textItem()]))])
        await fixture.emit(event);
      const retired = fixture.session[command]();
      await expect(pending).resolves.toBe('aborted');
      await retired;
      const before = fixture.session.getSnapshot();
      fixture.streams[0].release(
        chunk('provisional', [textItem('item', 'Late')])
      );
      await fixture.streams[0].closed;
      expect(fixture.session.getSnapshot()).toBe(before);
      await fixture.session.dispose();
    }
  );
});

it('keeps pause/resume, the next turn and fresh history on canonical IDs', async () => {
  const first = full(
    'call-response',
    [
      {
        type: 'function_call',
        id: 'function',
        call_id: 'server-call',
        index: 0,
      },
    ],
    { tool_calls: [{ id: 'server-call', name: 'server-only', args: {} }] }
  );
  const answer = full('answer-response', [textItem('answer-item', 'Approved')]);
  const next = full('next-response', [textItem('next-item', 'Next')]);
  const saved = [first, answer, next];
  let count = 0;
  const stream = vi.fn<AgentTransport['stream']>(async function* () {
    count++;
    if (count === 1) {
      yield chunk(first.id, []);
      yield chunk('call-chunks', first.content);
      yield {
        type: 'values',
        data: {
          messages: [first],
          __interrupt__: [{ id: 'pause', value: 'Approve' }],
        },
      };
    } else {
      const message = count === 2 ? answer : next;
      yield chunk(message.id, []);
      yield chunk(`chunks-${count}`, message.content);
      yield values(...saved.slice(0, count));
    }
  });
  const getHistory = vi.fn<NonNullable<AgentTransport['getHistory']>>(
    async () => [
      {
        values: { messages: saved },
        next: [],
        tasks: [],
        checkpoint: {
          thread_id: 'thread',
          checkpoint_id: 'checkpoint',
          checkpoint_ns: '',
          checkpoint_map: {},
        },
        metadata: null,
        parent_checkpoint: null,
        created_at: null,
      } as ThreadState,
    ]
  );
  const session = createSession({
    assistantId: 'agent',
    threadId: 'thread',
    transport: { stream, getHistory },
  });
  await expect(session.submit('First')).resolves.toBe('paused');
  expect(
    session
      .getSnapshot()
      .messages.filter((m) => m.role === 'assistant')
      .map((m) => m.id)
  ).toEqual([first.id]);
  await expect(session.resume({ pause: 'approved' })).resolves.toBe('success');
  expect(
    session
      .getSnapshot()
      .messages.filter((m) => m.role === 'assistant')
      .map((m) => m.id)
  ).toEqual([first.id, answer.id]);
  await expect(session.submit('Next')).resolves.toBe('success');
  expect(
    session
      .getSnapshot()
      .messages.filter((m) => m.role === 'assistant')
      .map((m) => m.id)
  ).toEqual(saved.map((m) => m.id));
  await session.dispose();
  const restored = createSession({
    assistantId: 'agent',
    threadId: 'thread',
    transport: { stream, getHistory },
  });
  expect(restored.load).toBeDefined();
  await restored.load!();
  expect(restored.getSnapshot().messages.map((m) => m.id)).toEqual(
    saved.map((m) => m.id)
  );
  expect(stream).toHaveBeenCalledTimes(3);
  await restored.dispose();
});

it('rejects a competing incomplete function owner that shares only the call ID', () => {
  const item = {
    type: 'function_call',
    id: 'function',
    call_id: 'call',
    index: 0,
  };
  const current = replay([
    chunk('provisional', [item]),
    chunk('competing', [{ type: 'function_call', call_id: 'call', index: 0 }]),
    values(full('canonical', [item])),
  ]);
  expect(current.state.messages.map((m) => m.id)).toEqual([
    'provisional',
    'competing',
    'canonical',
  ]);
});

it('indexes conflicting raw item claims even in unsupported or incomplete canonical blocks', () => {
  for (const content of [
    [{ type: 'image', id: 'item' }],
    [{ type: 'function_call', call_id: 'call' }],
  ]) {
    const item =
      content[0].type === 'image'
        ? textItem()
        : { type: 'function_call', id: 'function', call_id: 'call', index: 0 };
    const current = replay([
      chunk('provisional', [item]),
      values(full('canonical', [item]), full('other', content)),
    ]);
    expect(current.state.messages.map((m) => m.id)).toContain('provisional');
  }
});

it('keeps identical item IDs isolated in separately routed child namespaces', () => {
  let children = initialSubgraphs();
  for (const namespace of [['first'], ['second']]) {
    for (const event of [...open(), values(full('canonical', [textItem()]))])
      children = projectSubgraphs(
        children,
        { ...event, namespace },
        'physical'
      );
  }
  expect(
    children.subgraphs.map((child) =>
      child.messages.map((message) => message.id)
    )
  ).toEqual([['canonical'], ['canonical']]);
  expect(children.active.size).toBe(2);
});

it('removes an obsolete target lock from an empty interim candidate when identity becomes proven', () => {
  let current = { state: initialMessageState(), projection: projection() };
  for (const event of [
    values(full('canonical', [])),
    chunk('provisional', [textItem()]),
    values(full('canonical', [textItem()])),
    chunk('provisional', [textItem('item', 'B')]),
  ])
    current = projectStream(current.state, current.projection, event);
  expect(current.state.messages.map((m) => [m.id, m.content])).toEqual([
    ['canonical', 'AB'],
  ]);
  expect(current.projection.terminal).toBe(false);
  const final = projectStream(
    current.state,
    current.projection,
    values(full('canonical', [textItem('item', 'AB')]))
  );
  const locked = finalizeProjection(final.state, final.projection);
  const late = projectStream(
    locked,
    final.projection,
    chunk('provisional', [textItem('item', 'Late')])
  );
  expect(late.state.messages.map((m) => [m.id, m.content])).toEqual([
    ['canonical', 'AB'],
  ]);
});

it('rejects a contradictory canonical claim targeting an existing alias source', () => {
  const first = replay([
    chunk('provisional', [textItem('first')]),
    values(full('canonical', [textItem('first')])),
  ]);
  const next = projectStream(
    first.state,
    first.projection,
    chunk('new-provisional', [textItem('second')])
  );
  const contradictory = projectStream(
    next.state,
    next.projection,
    values(full('provisional', [textItem('second')]))
  );
  expect(contradictory.projection.responseIdentity?.aliases).toEqual([
    { from: 'provisional', to: 'canonical' },
  ]);
  expect(contradictory.state.messages.map((m) => m.id)).toContain(
    'new-provisional'
  );
});

it('preserves an earlier canonical row when a later full claim names the former provisional ID', () => {
  const first = replay([
    chunk('provisional', [textItem('first', 'First')]),
    values(full('canonical', [textItem('first', 'First')])),
  ]);
  const changed = projectStream(
    first.state,
    first.projection,
    values(full('provisional', [textItem('second', 'Unrelated')]))
  );
  const finalized = finalizeProjection(changed.state, changed.projection);
  expect(finalized.messages.map((m) => [m.id, m.content])).toEqual([
    ['canonical', 'First'],
    ['provisional', 'Unrelated'],
  ]);
  const late = projectStream(
    finalized,
    changed.projection,
    chunk('provisional', [textItem('second', 'Late')])
  );
  expect(late.state.messages.map((m) => [m.id, m.content])).toEqual([
    ['canonical', 'First'],
    ['provisional', 'Unrelated'],
  ]);
  expect(late.projection.responseIdentity?.aliases).toEqual([
    { from: 'provisional', to: 'canonical' },
  ]);
});

it('does not route a tainted provisional chunk into an established canonical message', () => {
  let current = { state: initialMessageState(), projection: projection() };
  for (const event of [...open(), values(full('canonical', [textItem()]))])
    current = projectStream(current.state, current.projection, event);
  const changed = projectStream(
    current.state,
    current.projection,
    chunk('provisional', [textItem('conflict', 'Wrong')])
  );
  expect(
    changed.state.messages.find((m) => m.id === 'canonical')?.content
  ).toBe('A');
  expect(
    changed.state.messages.find((m) => m.id === 'provisional')?.content
  ).toBe('Wrong');
});

it.each(['human', 'tool'])(
  'never rewrites a %s message ID through an assistant chunk alias',
  (type) => {
    const first = replay([...open(), values(full('canonical', [textItem()]))]);
    const next = projectStream(
      first.state,
      first.projection,
      values({ type, id: 'provisional', content: 'Distinct' })
    );
    expect(next.state.messages.map((m) => [m.id, m.role])).toEqual([
      ['canonical', 'assistant'],
      ['provisional', type === 'human' ? 'user' : 'tool'],
    ]);
  }
);
