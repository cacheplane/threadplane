import { it, expect, vi } from 'vitest';
import { createSkillsApplication, type SkillsSession } from './application';
import { authorityInput } from './test-fixtures';
import type { NativeSnapshot } from './authority';
function setup(status = 'success') {
  const input = authorityInput(status);
  let state: NativeSnapshot = {
    status: 'idle',
    messages: [],
    toolCalls: [],
    values: {},
    interrupts: [],
    subgraphs: [],
  };
  const listeners = new Set<() => void>();
  const session = {
    getSnapshot: () => state,
    subscribe: (f: () => void) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    submit: vi.fn(async () => {
      state = input.snapshot as NativeSnapshot;
      listeners.forEach((f) => f());
      return 'success' as const;
    }),
    load: vi.fn(async () => {
      state = input.loadedSnapshot as NativeSnapshot;
    }),
    stop: vi.fn(),
    dispose: vi.fn(),
  };
  const client = {
    createThread: vi.fn(async () => 'thread'),
    sessionFactory: vi.fn(() => session as unknown as SkillsSession),
    readCurrent: vi.fn(async () => input.observedState),
    readHistory: vi.fn(async () => input.history),
    readCheckpoint: vi.fn(async () => input.loadedCheckpoint),
  };
  return {
    app: createSkillsApplication(client),
    session,
    client,
    input,
    set: (s: NativeSnapshot) => {
      state = s;
      listeners.forEach((f) => f());
    },
  };
}
it('creates lazily only on explicit nonempty Send and prevents duplicate clicks', async () => {
  const x = setup();
  await x.app.newConversation();
  await x.app.submit(' ');
  await x.app.selectConversation('unknown');
  expect(x.client.createThread).not.toHaveBeenCalled();
  const first = x.app.submit('Inspect runway.');
  await x.app.submit('Inspect runway.');
  await first;
  expect(x.session.submit).toHaveBeenCalledTimes(1);
  expect(x.app.getSnapshot().canSubmit).toBe(true);
});
it('confirms tool errors honestly without disabling an otherwise confirmed parent', async () => {
  const x = setup('error');
  await x.app.submit('Inspect runway.');
  expect(x.app.getSnapshot().canSubmit).toBe(true);
  expect(x.app.getSnapshot().reads).toMatchObject([{ kind: 'error' }]);
});
it('confirms filtered live private values from the full checkpoint and keeps Send/history/read evidence available', async () => {
  const x = setup();
  delete (x.input.snapshot.values as any).skills_metadata;
  await x.app.submit('Inspect runway.');
  const view = x.app.getSnapshot();
  expect(view.canSubmit).toBe(true);
  expect(view.history).toHaveLength(1);
  expect(view.index).toMatchObject({ source: 'checkpoint' });
  expect(view.reads).toMatchObject([{ id: 'read', kind: 'inspected' }]);
  expect(x.session.load).toHaveBeenCalledTimes(1);
  await x.app.newConversation();
  await x.app.selectConversation('thread');
  expect(x.app.getSnapshot().canSubmit).toBe(true);
  expect(x.session.submit).toHaveBeenCalledTimes(1);
});
it('New preserves known local history and selection freshly reads without model execution', async () => {
  const x = setup();
  await x.app.submit('Inspect runway.');
  await x.app.newConversation();
  expect(x.app.getSnapshot().rows).toEqual([]);
  expect(x.app.getSnapshot().history).toHaveLength(1);
  await x.app.selectConversation('thread');
  expect(x.session.submit).toHaveBeenCalledTimes(1);
  expect(x.client.readCurrent).toHaveBeenCalledTimes(2);
  expect(x.app.getSnapshot().canSubmit).toBe(true);
  expect(x.app.getSnapshot().index).toMatchObject({ source: 'checkpoint' });
});
it('fresh selection refuses externally changed transcripts and cannot revive unsafe owners', async () => {
  const x = setup();
  await x.app.submit('Inspect runway.');
  await x.app.newConversation();
  x.input.observedState.values.messages[0].content = 'external';
  await x.app.selectConversation('thread');
  expect(x.app.getSnapshot().canSubmit).toBe(false);
  const count = x.client.readCurrent.mock.calls.length;
  await x.app.selectConversation('thread');
  expect(x.client.readCurrent).toHaveBeenCalledTimes(count);
});
it.each(['paused', 'error', 'aborted'])(
  'requires New after %s outcome',
  async (outcome) => {
    const x = setup();
    x.session.submit.mockResolvedValue(outcome as never);
    await x.app.submit('Inspect runway.');
    expect(x.app.getSnapshot().canSubmit).toBe(false);
    await x.app.submit('Again');
    expect(x.session.submit).toHaveBeenCalledTimes(1);
  }
);
it('Stop during creation invalidates stale return and requires New', async () => {
  const x = setup();
  let resolve!: (s: string) => void;
  x.client.createThread.mockImplementation(
    () => new Promise((r) => (resolve = r))
  );
  const run = x.app.submit('Inspect runway.');
  await x.app.stop();
  resolve('thread');
  await run;
  expect(x.session.submit).not.toHaveBeenCalled();
  expect(x.app.getSnapshot().canSubmit).toBe(false);
  await x.app.newConversation();
  expect(x.app.getSnapshot().canSubmit).toBe(true);
});
it('New cancels pending confirmation and disposal releases only owned work', async () => {
  const x = setup();
  let resolve!: (s: typeof x.input.observedState) => void;
  x.client.readCurrent.mockImplementation(
    () => new Promise((r) => (resolve = r))
  );
  const run = x.app.submit('Inspect runway.');
  await Promise.resolve();
  await Promise.resolve();
  await x.app.newConversation();
  resolve(x.input.observedState);
  await run;
  expect(x.app.getSnapshot().rows).toEqual([]);
  expect(x.session.load).not.toHaveBeenCalled();
  await x.app.dispose();
  expect(x.session.dispose).toHaveBeenCalledTimes(1);
});
it('new application clears the page-local catalog', () => {
  expect(setup().app.getSnapshot().history).toEqual([]);
});
it('routes new followup reads as pending/unknown while preserving prior confirmed read errors, then confirms fresh raw evidence', async () => {
  const x = setup('error');
  await x.app.submit('Inspect runway.');
  let finish!: (value: 'success') => void;
  x.session.submit.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const running = x.app.submit('Read the reference.');
  const delivery = {
    generation: 'followup-native',
    phase: 'complete',
    outcome: 'success',
  };
  const args = { file_path: '/skills/runway-analysis/reference/margins.md' };
  const pending = {
    ...x.input.loadedSnapshot,
    messages: [
      ...x.input.loadedSnapshot.messages,
      {
        id: 'followup-human',
        role: 'user',
        content: 'Read the reference.',
        delivery,
      },
      {
        id: 'followup-call',
        role: 'assistant',
        content: '',
        toolCallIds: ['followup-read'],
        delivery,
      },
    ],
    toolCalls: [
      ...x.input.loadedSnapshot.toolCalls,
      { id: 'followup-read', name: 'read_file', args, status: 'pending' },
    ],
  };
  x.set(pending as NativeSnapshot);
  expect(x.app.getSnapshot().reads).toMatchObject([
    { id: 'read', kind: 'error' },
    { id: 'followup-read', kind: 'pending' },
  ]);
  const currentCall = pending.toolCalls[1];
  x.set({
    ...pending,
    toolCalls: [...pending.toolCalls, currentCall],
  } as NativeSnapshot);
  expect(x.app.getSnapshot().reads).toMatchObject([
    { id: 'read', kind: 'error' },
    { id: 'followup-read', kind: 'unavailable' },
  ]);
  x.set({
    ...pending,
    toolCalls: [pending.toolCalls[0], ...Array(100).fill(currentCall)],
  } as NativeSnapshot);
  expect(x.app.getSnapshot().reads).toEqual({ kind: 'unavailable' });
  x.set(pending as NativeSnapshot);
  expect(x.app.getSnapshot().reads).toMatchObject([
    { id: 'read', kind: 'error' },
    { id: 'followup-read', kind: 'pending' },
  ]);
  const result = '1  reference';
  const complete = {
    ...pending,
    messages: [
      ...pending.messages,
      {
        id: 'followup-result',
        role: 'tool',
        name: 'read_file',
        toolCallId: 'followup-read',
        content: result,
        delivery,
      },
      {
        id: 'followup-final',
        role: 'assistant',
        content: 'Reference answer.',
        toolCallIds: [],
        delivery,
      },
    ],
    toolCalls: [
      ...x.input.loadedSnapshot.toolCalls,
      {
        id: 'followup-read',
        name: 'read_file',
        args,
        status: 'complete',
        result,
      },
    ],
  };
  x.set(complete as NativeSnapshot);
  expect(x.app.getSnapshot().reads).toMatchObject([
    { id: 'read', kind: 'error' },
    { id: 'followup-read', kind: 'unknown' },
  ]);
  const raw = {
    ...x.input.loadedCheckpoint,
    checkpoint: {
      ...x.input.loadedCheckpoint.checkpoint,
      checkpoint_id: 'followup-checkpoint',
    },
    values: {
      ...x.input.loadedCheckpoint.values,
      messages: [
        ...x.input.loadedCheckpoint.values.messages,
        { id: 'followup-human', type: 'human', content: 'Read the reference.' },
        {
          id: 'followup-call',
          type: 'ai',
          content: '',
          tool_calls: [
            { id: 'followup-read', name: 'read_file', args, type: 'tool_call' },
          ],
        },
        {
          id: 'followup-result',
          type: 'tool',
          name: 'read_file',
          tool_call_id: 'followup-read',
          content: result,
          status: 'success',
        },
        {
          id: 'followup-final',
          type: 'ai',
          content: 'Reference answer.',
          tool_calls: [],
        },
      ],
    },
  };
  x.client.readCurrent.mockResolvedValue(raw as never);
  x.client.readHistory.mockResolvedValue([raw] as never);
  x.client.readCheckpoint.mockResolvedValue(raw as never);
  x.session.load.mockImplementation(async () =>
    x.set(complete as NativeSnapshot)
  );
  finish('success');
  await running;
  expect(x.app.getSnapshot().canSubmit).toBe(true);
  expect(x.app.getSnapshot().reads).toMatchObject([
    { id: 'read', kind: 'error' },
    { id: 'followup-read', kind: 'inspected', category: 'reference' },
  ]);
});
it.each(['final', 'restore'])(
  'refuses unsupported child state acquired during %s native load',
  async (mode) => {
    const x = setup();
    if (mode === 'restore') {
      await x.app.submit('Inspect runway.');
      await x.app.newConversation();
    }
    x.input.loadedSnapshot.subgraphs.push({ id: 'unsupported' } as never);
    if (mode === 'restore') await x.app.selectConversation('thread');
    else await x.app.submit('Inspect runway.');
    expect(x.app.getSnapshot().canSubmit).toBe(false);
  }
);
it('cleanup releases the owned session even when subscription release throws', async () => {
  const x = setup();
  x.session.subscribe = () => () => {
    throw Error('release failed');
  };
  await x.app.submit('Inspect runway.');
  await expect(x.app.newConversation()).resolves.toBeUndefined();
  expect(x.session.dispose).toHaveBeenCalledTimes(1);
  expect(x.app.getSnapshot().threadId).toBeNull();
});
it('New from a restoration publication invalidates the operation before session acquisition', async () => {
  const x = setup();
  await x.app.submit('Inspect runway.');
  await x.app.newConversation();
  let once = false;
  x.app.subscribe(() => {
    if (x.app.getSnapshot().activity === 'restoring' && !once) {
      once = true;
      void x.app.newConversation();
    }
  });
  await x.app.selectConversation('thread');
  expect(x.app.getSnapshot().threadId).toBeNull();
  expect(x.client.sessionFactory).toHaveBeenCalledTimes(1);
});
it('Stop before a restoration session is acquired cannot reselect that unsafe saved thread', async () => {
  const x = setup();
  await x.app.submit('Inspect runway.');
  await x.app.newConversation();
  const restore = x.app.selectConversation('thread');
  await x.app.stop();
  await restore;
  await x.app.selectConversation('thread');
  expect(x.app.getSnapshot().canSubmit).toBe(false);
  expect(x.app.getSnapshot().history).toEqual([]);
});
it('bounds the page-local catalog and does not restore evicted IDs', async () => {
  const x = setup();
  let number = 0;
  x.client.createThread.mockImplementation(async () => {
    const id = `thread-${++number}`;
    for (const s of [
      x.input.observedState,
      x.input.loadedCheckpoint,
      ...x.input.history,
    ])
      s.checkpoint.thread_id = id;
    return id;
  });
  const factory = x.client.sessionFactory.getMockImplementation();
  if (!factory) throw Error('Missing session factory');
  x.client.sessionFactory.mockImplementation(() => {
    x.set({
      status: 'idle',
      messages: [],
      toolCalls: [],
      values: {},
      interrupts: [],
      subgraphs: [],
    });
    return factory();
  });
  for (let i = 0; i < 101; i++) {
    await x.app.newConversation();
    await x.app.submit('Inspect runway.');
  }
  expect(x.app.getSnapshot().history.length).toBeLessThanOrEqual(100);
  expect(x.app.getSnapshot().history.length).toBeGreaterThan(0);
  await x.app.newConversation();
  await x.app.selectConversation('thread-1');
  expect(x.app.getSnapshot().threadId).toBeNull();
});
it('bounds aggregate catalog text even before reaching the entry cap', async () => {
  const x = setup();
  const result = '1  ' + 'x'.repeat(39997);
  let number = 0;
  for (const state of [
    x.input.observedState,
    x.input.loadedCheckpoint,
    ...x.input.history,
  ])
    state.values.messages[2].content = result;
  for (const state of [x.input.snapshot, x.input.loadedSnapshot]) {
    state.messages[2].content = result;
    state.toolCalls[0].result = result;
  }
  x.client.createThread.mockImplementation(async () => {
    const id = `large-${++number}`;
    for (const state of [
      x.input.observedState,
      x.input.loadedCheckpoint,
      ...x.input.history,
    ])
      state.checkpoint.thread_id = id;
    return id;
  });
  const factory = x.client.sessionFactory.getMockImplementation();
  if (!factory) throw Error('Missing session factory');
  x.client.sessionFactory.mockImplementation(() => {
    x.set({
      status: 'idle',
      messages: [],
      toolCalls: [],
      values: {},
      interrupts: [],
      subgraphs: [],
    });
    return factory();
  });
  for (let i = 0; i < 40; i++) {
    await x.app.newConversation();
    await x.app.submit('Inspect runway.');
  }
  expect(x.app.getSnapshot().canSubmit).toBe(true);
  expect(x.app.getSnapshot().history.length).toBeLessThan(40);
  expect(x.app.getSnapshot().history.length).toBeGreaterThan(0);
});
it('changing native generation during a turn permanently invalidates that owner', async () => {
  const x = setup();
  x.session.submit.mockImplementation(async () => {
    x.set(x.input.snapshot as NativeSnapshot);
    const changed = structuredClone(x.input.snapshot);
    changed.messages[0].delivery.generation = 'foreign';
    x.set(changed as NativeSnapshot);
    x.set(x.input.snapshot as NativeSnapshot);
    return 'success';
  });
  await x.app.submit('Inspect runway.');
  expect(x.app.getSnapshot().canSubmit).toBe(false);
});
it('malformed live state never reaches the display and requires New', async () => {
  const x = setup();
  x.session.submit.mockImplementation(async () => {
    x.set({ messages: null } as never);
    return 'success';
  });
  await x.app.submit('Inspect runway.');
  expect(x.app.getSnapshot().canSubmit).toBe(false);
  expect(x.app.getSnapshot().rows).toEqual([]);
});
it('unsupported child state cannot masquerade as confirmed root skill evidence', async () => {
  const x = setup();
  delete (x.input.snapshot.values as any).skills_metadata;
  x.input.snapshot.subgraphs.push({ id: 'child' } as never);
  x.input.loadedSnapshot.subgraphs.push({ id: 'child' } as never);
  await x.app.submit('Inspect runway.');
  expect(x.app.getSnapshot().canSubmit).toBe(false);
});
it('keeps prior confirmed tool errors visible during a fresh followup', async () => {
  const x = setup('error');
  await x.app.submit('Inspect runway.');
  let finish!: (s: 'success') => void;
  x.session.submit.mockImplementation(() => new Promise((r) => (finish = r)));
  const run = x.app.submit('Follow up.');
  expect(x.app.getSnapshot().reads).toMatchObject([{ kind: 'error' }]);
  await x.app.stop();
  finish('success');
  await run;
});
it('New during an unfinished followup cannot revive its previous catalog authority', async () => {
  const x = setup();
  await x.app.submit('Inspect runway.');
  let finish!: (s: 'success') => void;
  x.session.submit.mockImplementation(() => new Promise((r) => (finish = r)));
  const run = x.app.submit('Follow up.');
  await Promise.resolve();
  await x.app.newConversation();
  await x.app.selectConversation('thread');
  finish('success');
  await run;
  expect(x.app.getSnapshot().threadId).toBeNull();
  expect(x.app.getSnapshot().history).toEqual([]);
});
it('a restored owner follows up with its full saved raw baseline without creating another thread', async () => {
  const x = setup();
  await x.app.submit('Inspect runway.');
  await x.app.newConversation();
  await x.app.selectConversation('thread');
  const raw = [
    ...x.input.loadedCheckpoint.values.messages,
    { id: 'h2', type: 'human', content: 'Follow up.' },
    { id: 'a2', type: 'ai', content: 'Answer.', tool_calls: [] },
  ];
  const delivery = { generation: 'g2', phase: 'complete', outcome: 'success' };
  const native = {
    ...x.input.loadedSnapshot,
    messages: [
      ...x.input.loadedSnapshot.messages,
      { id: 'h2', role: 'user', content: 'Follow up.', delivery },
      {
        id: 'a2',
        role: 'assistant',
        content: 'Answer.',
        toolCallIds: [],
        delivery,
      },
    ],
  };
  const saved = {
    ...x.input.loadedCheckpoint,
    checkpoint: {
      ...x.input.loadedCheckpoint.checkpoint,
      checkpoint_id: 'second',
    },
    values: { ...x.input.loadedCheckpoint.values, messages: raw },
  };
  x.client.readCurrent.mockResolvedValue(saved as never);
  x.client.readHistory.mockResolvedValue([saved] as never);
  x.client.readCheckpoint.mockResolvedValue(saved as never);
  x.session.load.mockImplementation(async () =>
    x.set(native as NativeSnapshot)
  );
  x.session.submit.mockImplementation(async () => {
    x.set(native as NativeSnapshot);
    expect(x.app.getSnapshot().rows.at(-1)?.message.content).toBe('Answer.');
    return 'success';
  });
  await x.app.submit('Follow up.');
  expect(x.app.getSnapshot().canSubmit).toBe(true);
  expect(x.client.createThread).toHaveBeenCalledTimes(1);
});
