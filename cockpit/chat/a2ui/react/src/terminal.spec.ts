import { describe, expect, it } from 'vitest';
import {
  createObservation,
  captureOwned,
  captureTerminal,
  checkpointSource,
  prepareTerminal,
} from './terminal.js';
const message = (
  id: string,
  role: string,
  content: string,
  generation = id
) => ({
  id,
  role,
  content,
  delivery: { generation, phase: 'complete', outcome: 'success' },
});
function turn() {
  const operation = {};
  const previous = [
    message('u0', 'user', 'before'),
    message('a0', 'assistant', 'prior'),
  ];
  const human = message('u1', 'user', 'request', 'execution-1');
  const checkpoint = {
    thread_id: 'thread',
    checkpoint_ns: '',
    checkpoint_id: 'cp',
    checkpoint_map: { '': 'cp' },
  };
  const settled: any = {
    status: 'idle',
    messages: [
      ...previous,
      human,
      message('callback', 'assistant', '---a2ui_JSON---\nfake'),
    ],
    toolCalls: [],
    interrupts: [],
    subgraphs: [],
  };
  const loaded: any = {
    ...settled,
    messages: [
      ...structuredClone(previous),
      message('u1', 'user', 'request'),
      message('a1', 'assistant', 'saved'),
    ],
    history: [{ checkpoint, next: [] }],
    values: {},
  };
  const raw: any = {
    checkpoint,
    next: [],
    tasks: [],
    values: {
      messages: loaded.messages.map((m: any) => ({
        id: m.id,
        type: m.role === 'user' ? 'human' : 'ai',
        content: m.content,
        name: null,
        additional_kwargs: {},
        response_metadata: {},
        ...(m.role === 'assistant'
          ? { tool_calls: [], invalid_tool_calls: [], usage_metadata: null }
          : {}),
      })),
    },
  };
  const observation = createObservation({
    threadId: 'thread',
    input: 'request',
    previous,
  });
  observation.observe(settled);
  const owned = () =>
    captureOwned({ observation, outcome: 'success', snapshot: settled });
  return { operation, previous, settled, loaded, raw, owned, observation };
}
describe('canonical owned c-a2ui terminal admission', () => {
  it('admits saved IDs after execution generation rebase, without completed markers', () => {
    const t = turn();
    const result = captureTerminal(t.owned(), t.loaded, t.raw);
    expect(result?.messages.map((m) => m.id)).toEqual(['u0', 'a0', 'u1', 'a1']);
    expect(result?.messages.at(-1)?.content).toBe('saved');
    t.loaded.messages[3].content = 'mutated';
    expect(result?.messages.at(-1)?.content).toBe('saved');
    expect(Object.isFrozen(result?.messages[3])).toBe(true);
  });
  it.each(['error', 'aborted', 'paused', 'interrupted', undefined])(
    'rejects non-success owned outcome %s',
    (outcome) => {
      const t = turn();
      expect(
        captureOwned({
          observation: t.observation,
          outcome,
          snapshot: t.settled,
        })
      ).toBeUndefined();
    }
  );
  const invalid: [string, (t: ReturnType<typeof turn>) => void][] = [
    ['running', (t) => (t.loaded.status = 'running')],
    ['error', (t) => (t.loaded.error = 'bad')],
    ['pause', (t) => (t.loaded.pause = {})],
    ['interrupt', (t) => (t.loaded.interrupts = [{}])],
    ['child', (t) => (t.loaded.subgraphs = [{}])],
    ['tools', (t) => (t.loaded.toolCalls = [{}])],
    ['next', (t) => (t.raw.next = ['work'])],
    ['task', (t) => (t.raw.tasks = [{}])],
    ['missing tasks', (t) => delete t.raw.tasks],
    ['raw error', (t) => (t.raw.error = 'bad')],
    ['malformed error', (t) => (t.raw.error = [])],
    ['raw pause', (t) => (t.raw.values.__interrupt__ = [{}])],
    ['raw child', (t) => (t.raw.subgraphs = [{}])],
    [
      'wrong thread',
      (t) => (t.raw.checkpoint = { ...t.raw.checkpoint, thread_id: 'else' }),
    ],
    [
      'wrong checkpoint',
      (t) =>
        (t.raw.checkpoint = { ...t.raw.checkpoint, checkpoint_id: 'else' }),
    ],
    [
      'wrong map',
      (t) =>
        (t.raw.checkpoint = {
          ...t.raw.checkpoint,
          checkpoint_map: { '': 'else' },
        }),
    ],
    [
      'empty map',
      (t) => (t.raw.checkpoint = { ...t.raw.checkpoint, checkpoint_map: {} }),
    ],
    [
      'child map',
      (t) =>
        (t.raw.checkpoint = {
          ...t.raw.checkpoint,
          checkpoint_map: { child: 'cp' },
        }),
    ],
    [
      'changed prefix',
      (t) => (t.loaded.messages[0] = message('u0', 'user', 'changed')),
    ],
    [
      'wrong human',
      (t) => (t.loaded.messages[2] = message('other', 'user', 'request')),
    ],
    ['duplicate IDs', (t) => (t.loaded.messages[3].id = 'u0')],
    [
      'extra canonical message',
      (t) => t.loaded.messages.push(message('extra', 'assistant', 'extra')),
    ],
    ['incomplete', (t) => (t.loaded.messages[3].delivery.phase = 'streaming')],
    [
      'failed delivery',
      (t) => (t.loaded.messages[3].delivery.outcome = 'error'),
    ],
    ['tool metadata', (t) => (t.loaded.messages[3].toolCallIds = ['tool'])],
    ['raw tool metadata', (t) => (t.raw.values.messages[3].tool_calls = [{}])],
    [
      'raw invalid tools',
      (t) => (t.raw.values.messages[3].invalid_tool_calls = [{}]),
    ],
    [
      'raw function',
      (t) => (t.raw.values.messages[3].additional_kwargs.function_call = {}),
    ],
    ['raw mismatch', (t) => (t.raw.values.messages[3].content = 'else')],
    ['raw extra', (t) => t.raw.values.messages.push({})],
    ['raw name mismatch', (t) => (t.raw.values.messages[3].name = 'other')],
  ];
  it.each(invalid)('rejects %s', (_name, change) => {
    const t = turn();
    const owned = t.owned();
    change(t);
    expect(captureTerminal(owned, t.loaded, t.raw)).toBeUndefined();
  });
  it('does not let completion markers or full-looking transient callbacks grant authority', () => {
    const t = turn();
    t.settled.history = t.loaded.history;
    t.raw.values.completed_turn_id = 'u1';
    t.raw.values.completed_answer_id = 'callback';
    expect(captureTerminal(t.owned(), t.settled, t.raw)).toBeUndefined();
  });
  it('captures semantic prior/human independently of caller mutation', () => {
    const t = turn();
    const owned = t.owned();
    t.previous[0].content = 'changed';
    expect(captureTerminal(owned, t.loaded, t.raw)).toBeDefined();
  });
  it('rejects changed prior and ambiguous human at initial owned capture', () => {
    const t = turn();
    t.settled.messages[0] = message('u0', 'user', 'changed');
    expect(t.owned()).toBeUndefined();
    const u = turn();
    u.settled.messages.push(message('u2', 'user', 'request'));
    expect(u.owned()).toBeUndefined();
  });
  it('requires during-run human observation and rejects changed or reused generations', () => {
    const t = turn();
    const blank = createObservation({
      threadId: 'thread',
      input: 'request',
      previous: t.previous,
    });
    expect(
      captureOwned({
        observation: blank,
        outcome: 'success',
        snapshot: t.settled,
      })
    ).toBeUndefined();
    t.settled.messages[2].delivery.generation = 'a0';
    t.observation.observe(t.settled);
    expect(t.owned()).toBeUndefined();
    const u = turn();
    u.settled.messages[2].delivery.generation = 'another';
    u.observation.observe(u.settled);
    expect(u.owned()).toBeUndefined();
    const v = turn();
    v.settled.messages[2].content = 'wrong';
    v.observation.observe(v.settled);
    expect(v.owned()).toBeUndefined();
  });
  it('captures initial scalar operation inputs and refuses pre-load pending tools', () => {
    const t = turn();
    const input = {
      threadId: 'thread',
      input: 'request',
      previous: t.previous,
    };
    const observation = createObservation(input);
    input.threadId = 'other';
    input.input = 'changed';
    observation.observe(t.settled);
    expect(
      captureOwned({ observation, outcome: 'success', snapshot: t.settled })
        ?.threadId
    ).toBe('thread');
    t.settled.toolCalls = [{ status: 'pending' }];
    expect(t.owned()).toBeUndefined();
    const u = turn();
    u.settled.messages[2].delivery.phase = 'streaming';
    expect(u.owned()).toBeUndefined();
  });
  it('checks checkpoint closed fields without executing getters', () => {
    let reads = 0;
    const cp = Object.defineProperty({}, 'thread_id', {
      get() {
        reads++;
        return 'thread';
      },
    });
    expect(
      checkpointSource(
        {
          thread_id: 'thread',
          checkpoint_ns: '',
          checkpoint_id: 'cp',
          checkpoint_map: {},
        },
        'thread'
      )
    ).toBeUndefined();
    expect(checkpointSource(cp, 'thread')).toBeUndefined();
    expect(reads).toBe(0);
    expect(
      checkpointSource(
        {
          thread_id: 'thread',
          checkpoint_ns: '',
          checkpoint_id: 'cp',
          extra: true,
        },
        'thread'
      )
    ).toBeUndefined();
  });
  async function run(
    change:
      | 'none'
      | 'before'
      | 'load'
      | 'read'
      | 'snapshot'
      | 'mutation'
      | 'failure'
  ) {
    const t = turn();
    let current = t.operation;
    let snapshot = t.settled;
    const calls: string[] = [];
    if (change === 'before') current = {};
    const result = await prepareTerminal({
      operation: t.operation,
      observation: t.observation,
      outcome: change === 'failure' ? 'error' : 'success',
      getOperation: () => current,
      getSnapshot: () => snapshot,
      load: async () => {
        calls.push('load');
        snapshot = t.loaded;
        if (change === 'load') current = {};
      },
      read: async (cp) => {
        calls.push('read');
        expect(cp).toEqual(t.raw.checkpoint);
        if (change === 'read') current = {};
        if (change === 'snapshot') snapshot = { ...snapshot };
        if (change === 'mutation')
          snapshot.messages[3].content = 'mutated during read';
        return t.raw;
      },
    });
    return { result, calls };
  }
  it('requires actual success before load then exact checkpoint read', async () => {
    expect((await run('none')).result.kind).toBe('prepared');
    for (const c of ['before', 'failure'] as const) {
      const r = await run(c);
      expect(r.result.kind).toBe('unavailable');
      expect(r.calls).toEqual([]);
    }
  });
  it.each(['load', 'read', 'snapshot', 'mutation'] as const)(
    'fences stale state after %s await',
    async (c) => {
      const r = await run(c);
      expect(r.result.kind).toBe('unavailable');
      expect(r.calls).toEqual(c === 'load' ? ['load'] : ['load', 'read']);
    }
  );
  it('never rescues a rejected exact read using plausible history', async () => {
    const t = turn();
    let snapshot = t.settled;
    let reads = 0;
    const result = await prepareTerminal({
      operation: t.operation,
      observation: t.observation,
      outcome: 'success',
      getOperation: () => t.operation,
      getSnapshot: () => snapshot,
      load: async () => {
        snapshot = t.loaded;
      },
      read: async () => {
        reads++;
        throw Error('uncertain');
      },
    });
    expect(result.kind).toBe('unavailable');
    expect(reads).toBe(1);
  });
});
