import { createBrowserScope } from './browser-scope';
import { createMemoryApplication } from './application';
import { it, expect, vi } from 'vitest';
const SCOPE = '11111111-1111-4111-8111-111111111111';
function setup() {
  let stored: string | null = SCOPE;
  const scope = createBrowserScope({
    storage: () => ({
      getItem: () => stored,
      setItem: (_k, v) => {
        stored = v;
      },
    }),
    uuid: () => SCOPE,
  });
  const delivery = {
    generation: 'sdk-generation',
    phase: 'complete',
    outcome: 'success',
  };
  const args = {
    file_path: '/memories/AGENTS.md',
    content: 'Literal\n\nMemory\n',
  };
  const result = '<literal> saved';
  const raw = [
    { id: 'human', type: 'human', content: 'Teach memory.' },
    {
      id: 'call',
      type: 'ai',
      content: '',
      tool_calls: [
        { id: 'write', name: 'write_file', args, type: 'tool_call' },
      ],
    },
    {
      id: 'result',
      type: 'tool',
      content: result,
      name: 'write_file',
      tool_call_id: 'write',
      status: 'success',
    },
    { id: 'final', type: 'ai', content: 'Remembered.', tool_calls: [] },
  ];
  const values = {
    messages: raw,
    files: {},
    memory_contents: { '/memories/AGENTS.md': 'Literal\n\nMemory\n' },
    memory_scope_owner: SCOPE,
  };
  const saved = {
    values,
    next: [],
    tasks: [],
    checkpoint: {
      thread_id: 'thread',
      checkpoint_ns: '',
      checkpoint_id: 'checkpoint',
    },
  };
  const native = {
    status: 'idle',
    messages: [
      { id: 'human', role: 'user', content: 'Teach memory.', delivery },
      {
        id: 'call',
        role: 'assistant',
        content: '',
        toolCallIds: ['write'],
        delivery,
      },
      {
        id: 'result',
        role: 'tool',
        name: 'write_file',
        toolCallId: 'write',
        content: result,
        delivery,
      },
      {
        id: 'final',
        role: 'assistant',
        content: 'Remembered.',
        toolCallIds: [],
        delivery,
      },
    ],
    toolCalls: [
      { id: 'write', name: 'write_file', args, status: 'complete', result },
    ],
    values: {
      files: {},
      memory_contents: values.memory_contents,
      memory_scope_owner: SCOPE,
    },
    interrupts: [],
    subgraphs: [],
  };
  let state: any = {
    status: 'idle',
    messages: [],
    toolCalls: [],
    interrupts: [],
    subgraphs: [],
  };
  const listeners = new Set<() => void>();
  let observe: ((event: unknown) => void) | undefined;
  const event = {
    name: 'deep_agents.memory',
    data: {
      memory_scope_owner: SCOPE,
      memory_contents: values.memory_contents,
      phase: 'terminal',
    },
  };
  const set = (v: any) => {
    state = v;
    listeners.forEach((f) => f());
  };
  const session = {
    getSnapshot: () => state,
    subscribe: (f: () => void) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    submit: vi.fn(async () => {
      set(native);
      observe?.(event);
      return 'success';
    }),
    load: vi.fn(async () => {
      state = native;
    }),
    stop: vi.fn(),
    dispose: vi.fn(),
  };
  const client = {
    createThread: vi.fn(async () => 'thread'),
    sessionFactory: vi.fn(() => session),
    observeMemory: vi.fn((_id: string, f: (event: unknown) => void) => {
      observe = f;
      return () => {
        observe = undefined;
      };
    }),
    readCurrent: vi.fn(async () => saved),
    readHistory: vi.fn(async () => [saved]),
    readCheckpoint: vi.fn(async () => saved),
  };
  return {
    app: createMemoryApplication(client as never, scope),
    scope,
    client,
    session,
    event,
    native,
    saved,
    set,
    observe: (e: unknown) => observe?.(e),
    setStorage: (v: string | null) => {
      stored = v;
    },
  };
}
it('Send lazily creates and sends exact scoped context, then confirms raw and native Memory', async () => {
  const x = setup();
  await x.app.newConversation();
  await x.app.submit(' ');
  await x.app.selectConversation('foreign');
  expect(x.client.createThread).not.toHaveBeenCalled();
  await x.app.submit('Teach memory.');
  expect(x.session.submit).toHaveBeenCalledWith(
    'Teach memory.',
    expect.objectContaining({ context: { memory_scope: SCOPE } })
  );
  expect(x.app.getSnapshot()).toMatchObject({
    canSubmit: true,
    memory: { kind: 'checkpoint', contents: 'Literal\n\nMemory\n' },
    authority: { kind: 'terminal' },
    history: [{ id: 'thread' }],
  });
  expect(x.session.load).toHaveBeenCalledTimes(1);
});
it('storage setup failure admits zero thread/run requests', async () => {
  const x = setup();
  const scope = createBrowserScope({
    storage: () => {
      throw Error('blocked');
    },
    uuid: () => SCOPE,
  });
  const app = createMemoryApplication(x.client as never, scope);
  await app.submit('Teach memory.');
  expect(x.client.createThread).not.toHaveBeenCalled();
  expect(x.session.submit).not.toHaveBeenCalled();
  expect(app.getSnapshot().canSubmit).toBe(false);
});
it('storage changes during asynchronous creation prevent the run', async () => {
  const x = setup();
  let finish!: (id: string) => void;
  x.client.createThread.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  const pending = x.app.submit('Teach memory.');
  x.setStorage(null);
  finish('thread');
  await pending;
  expect(x.session.submit).not.toHaveBeenCalled();
  expect(x.app.getSnapshot().scopeWarning).toContain('identity changed');
});
it('followup clears current confirmation and checks scope every turn', async () => {
  const x = setup();
  await x.app.submit('Teach memory.');
  let finish!: (v: string) => void;
  x.session.submit.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  const pending = x.app.submit('Again');
  expect(x.app.getSnapshot().memory.kind).toBe('none');
  expect(x.app.getSnapshot().authority.kind).toBe('unconfirmed');
  await x.app.stop();
  finish('success');
  await pending;
  x.setStorage(null);
  await x.app.newConversation();
  await x.app.submit('Again');
  expect(x.session.submit).toHaveBeenCalledTimes(2);
  expect(x.app.getSnapshot().canSubmit).toBe(false);
});
it('active captured work settles after scope failure, future authoring stays disabled', async () => {
  const x = setup();
  x.session.submit.mockImplementation(async () => {
    x.setStorage(null);
    x.scope.admit();
    x.set(x.native);
    x.observe(x.event);
    return 'success';
  });
  await x.app.submit('Teach memory.');
  expect(x.app.getSnapshot().memory.kind).toBe('checkpoint');
  expect(x.app.getSnapshot().canSubmit).toBe(false);
  expect(x.app.getSnapshot().scopeWarning).toContain('identity changed');
  await x.app.submit('Again');
  expect(x.session.submit).toHaveBeenCalledTimes(1);
});
it('fresh raw and loaded native confirmation establishes checkpoint even without optional custom', async () => {
  const x = setup();
  x.session.submit.mockImplementation(async () => {
    x.set(x.native);
    return 'success';
  });
  await x.app.submit('Teach memory.');
  expect(x.app.getSnapshot().memory.kind).toBe('checkpoint');
  expect(x.app.getSnapshot().outcome).toBe('success');
});
it.each(['malformed', 'foreign'])(
  '%s matching Memory revokes confirmation without fallback',
  async (mode) => {
    const x = setup();
    x.session.submit.mockImplementation(async () => {
      x.set(x.native);
      x.observe(x.event);
      x.observe(
        mode === 'foreign'
          ? {
              ...x.event,
              data: {
                ...x.event.data,
                memory_scope_owner: '22222222-2222-4222-8222-222222222222',
              },
            }
          : { name: 'deep_agents.memory', data: null }
      );
      return 'success';
    });
    await x.app.submit('Teach memory.');
    expect(x.app.getSnapshot().memory.kind).toBe('unavailable');
    expect(x.app.getSnapshot().canSubmit).toBe(false);
    expect(x.app.getSnapshot().authority.kind).toBe('unconfirmed');
  }
);
it('New clears evidence, restore freshly reads owned history even when storage is blocked', async () => {
  const x = setup();
  await x.app.submit('Teach memory.');
  await x.app.newConversation();
  expect(x.app.getSnapshot().rows).toEqual([]);
  expect(x.app.getSnapshot().memory.kind).toBe('none');
  x.setStorage(null);
  x.scope.admit();
  await x.app.selectConversation('thread');
  expect(x.session.submit).toHaveBeenCalledTimes(1);
  expect(x.app.getSnapshot().memory.kind).toBe('checkpoint');
  expect(x.app.getSnapshot().canSubmit).toBe(false);
});
it.each(['readCurrent', 'readHistory', 'readCheckpoint'] as const)(
  'failed %s blocks without fallback',
  async (method) => {
    const x = setup();
    x.client[method].mockRejectedValue(Error('private failure'));
    await x.app.submit('Teach memory.');
    expect(x.app.getSnapshot().memory.kind).toBe('unavailable');
    expect(x.app.getSnapshot().canSubmit).toBe(false);
    expect(x.app.getSnapshot().error).not.toContain('private failure');
  }
);
it('Stop/New/dispose revoke late events and attempt all cleanup', async () => {
  const x = setup();
  let late: ((v: unknown) => void) | undefined;
  x.client.observeMemory.mockImplementation((_id, f) => {
    late = f;
    return () => {
      throw Error('release');
    };
  });
  let finish!: (v: string) => void;
  x.session.submit.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  const pending = x.app.submit('Teach memory.');
  await Promise.resolve();
  await x.app.stop();
  await x.app.newConversation();
  late?.(x.event);
  finish('success');
  await pending;
  await x.app.dispose();
  expect(x.session.stop).toHaveBeenCalledTimes(1);
  expect(x.session.dispose).toHaveBeenCalledTimes(1);
  expect(x.app.getSnapshot().memory.kind).toBe('none');
});
it('reload has empty page catalog and construction never authors', () => {
  const x = setup();
  expect(x.app.getSnapshot().history).toEqual([]);
  expect(x.client.createThread).not.toHaveBeenCalled();
  expect(x.session.submit).not.toHaveBeenCalled();
});

it('valid custom plus malformed terminal Memory cannot confirm or enter catalog', async () => {
  const x = setup();
  x.session.submit.mockImplementation(async () => {
    x.set(x.native);
    x.observe(x.event);
    x.saved.values.memory_contents = { '/foreign': 'wrong' } as never;
    x.native.values.memory_contents = x.saved.values.memory_contents;
    return 'success';
  });
  await x.app.submit('Teach memory.');
  expect(x.app.getSnapshot().memory.kind).toBe('unavailable');
  expect(x.app.getSnapshot().authority.kind).toBe('unconfirmed');
  expect(x.app.getSnapshot().history).toEqual([]);
  expect(x.app.getSnapshot().canSubmit).toBe(false);
});
it.each(['error', 'aborted', 'interrupted'] as const)(
  'non-success %s revokes Memory and requires New',
  async (outcome) => {
    const x = setup();
    x.session.submit.mockResolvedValue(outcome);
    await x.app.submit('Teach memory.');
    expect(x.app.getSnapshot().memory.kind).toBe('unavailable');
    expect(x.app.getSnapshot().history).toEqual([]);
    expect(x.app.getSnapshot().canSubmit).toBe(false);
    await x.app.submit('Again');
    expect(x.session.submit).toHaveBeenCalledTimes(1);
    await x.app.newConversation();
    expect(x.app.getSnapshot().canSubmit).toBe(true);
  }
);
it.each([
  'human',
  'generation',
  'partial',
  'child',
  'args',
  'result',
  'checkpoint',
  'ordinary-values',
  'loaded-private',
] as const)(
  'rejects %s evidence and clears current authority',
  async (kind) => {
    const x = setup();
    if (kind === 'human') x.native.messages[0].content = 'Foreign';
    if (kind === 'generation')
      x.native.messages[1].delivery = {
        generation: 'foreign',
        phase: 'complete',
        outcome: 'success',
      };
    if (kind === 'partial')
      x.native.messages[1].delivery = {
        generation: 'sdk-generation',
        phase: 'streaming',
        outcome: 'success',
      };
    if (kind === 'child') x.native.subgraphs.push({ id: 'child' } as never);
    if (kind === 'args')
      x.native.toolCalls[0].args = { content: 'altered' } as never;
    if (kind === 'result') x.native.toolCalls[0].result = 'altered';
    if (kind === 'checkpoint') x.saved.checkpoint.checkpoint_ns = 'child';
    if (kind === 'ordinary-values') delete (x.native.values as any).files;
    if (kind === 'loaded-private')
      x.session.load.mockImplementation(async () => {
        const native = structuredClone(x.native);
        delete (native.values as any).memory_scope_owner;
        x.set(native);
      });
    await x.app.submit('Teach memory.');
    expect(x.app.getSnapshot().canSubmit).toBe(false);
    expect(x.app.getSnapshot().authority.kind).toBe('unconfirmed');
    expect(x.app.getSnapshot().history).toEqual([]);
  }
);
it('filtered live private values are allowed but actual loaded values must contain both private keys', async () => {
  const x = setup();
  x.session.submit.mockImplementation(async () => {
    const native = structuredClone(x.native);
    delete (native.values as any).memory_scope_owner;
    delete (native.values as any).memory_contents;
    x.set(native);
    x.observe(x.event);
    return 'success';
  });
  await x.app.submit('Teach memory.');
  expect(x.app.getSnapshot().canSubmit).toBe(true);
  expect(x.app.getSnapshot().memory.kind).toBe('checkpoint');
});
it('terminal custom remains live until fresh raw/native reads finish', async () => {
  const x = setup();
  let finish!: (v: typeof x.saved) => void;
  x.client.readCurrent.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  const run = x.app.submit('Teach memory.');
  await Promise.resolve();
  await Promise.resolve();
  expect(x.app.getSnapshot().memory).toMatchObject({
    kind: 'live',
    phase: 'terminal',
  });
  expect(x.app.getSnapshot().authority.kind).toBe('unconfirmed');
  finish(x.saved);
  await run;
  expect(x.app.getSnapshot().memory.kind).toBe('checkpoint');
});
it('New during pending confirmation prevents stale publication and no model runs during restore', async () => {
  const x = setup();
  let finish!: (v: typeof x.saved) => void;
  x.client.readCurrent.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  const run = x.app.submit('Teach memory.');
  await Promise.resolve();
  await Promise.resolve();
  await x.app.newConversation();
  finish(x.saved);
  await run;
  expect(x.app.getSnapshot().rows).toEqual([]);
  expect(x.app.getSnapshot().memory.kind).toBe('none');
  expect(x.session.load).not.toHaveBeenCalled();
});
it('catalog evicts old entries at the actual entry limit', async () => {
  const x = setup();
  let count = 0;
  x.client.createThread.mockImplementation(async () => {
    const id = `thread-${++count}`;
    x.saved.checkpoint.thread_id = id;
    return id;
  });
  x.client.sessionFactory.mockImplementation(() => {
    x.set({
      status: 'idle',
      messages: [],
      toolCalls: [],
      interrupts: [],
      subgraphs: [],
    });
    return x.session;
  });
  for (let i = 0; i < 101; i++) {
    await x.app.newConversation();
    await x.app.submit('Teach memory.');
  }
  expect(x.app.getSnapshot().canSubmit).toBe(true);
  expect(x.app.getSnapshot().history.length).toBeLessThanOrEqual(100);
  await x.app.newConversation();
  await x.app.selectConversation('thread-1');
  expect(x.app.getSnapshot().threadId).toBeNull();
});
it('catalog bounds aggregate retained raw/native text', async () => {
  const x = setup();
  const contents = 'x'.repeat(60000);
  x.saved.values.memory_contents['/memories/AGENTS.md'] = contents;
  x.event.data.memory_contents = x.saved.values.memory_contents;
  x.native.values.memory_contents = x.saved.values.memory_contents;
  let count = 0;
  x.client.createThread.mockImplementation(async () => {
    x.saved.checkpoint.thread_id = `large-${++count}`;
    return x.saved.checkpoint.thread_id;
  });
  x.client.sessionFactory.mockImplementation(() => {
    x.set({
      status: 'idle',
      messages: [],
      toolCalls: [],
      interrupts: [],
      subgraphs: [],
    });
    return x.session;
  });
  for (let i = 0; i < 40; i++) {
    await x.app.newConversation();
    await x.app.submit('Teach memory.');
  }
  expect(x.app.getSnapshot().canSubmit).toBe(true);
  expect(x.app.getSnapshot().history.length).toBeLessThan(40);
  expect(x.app.getSnapshot().history.length).toBeGreaterThan(0);
});
it('session acquisition failure still disposes acquired owned session', async () => {
  const x = setup();
  x.session.subscribe = () => {
    throw Error('subscribe unavailable');
  };
  await x.app.submit('Teach memory.');
  expect(x.session.dispose).toHaveBeenCalledTimes(1);
  expect(x.app.getSnapshot().canSubmit).toBe(false);
});
