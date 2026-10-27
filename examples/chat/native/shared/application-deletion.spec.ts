import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApplication } from './application.js';
const tick = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function fixture(
  remove: (id: string, signal: AbortSignal) => Promise<unknown>,
  inspectRemoval: () => Promise<unknown> = async () => ({
    kind: 'missing',
    id: 'a',
  })
) {
  const directory = {
    list: async () => ({
      kind: 'ready' as const,
      value: [
        { id: 'a', title: 'Alpha', pinned: true },
        { id: 'b', title: 'Beta', pinned: true },
      ],
    }),
    get: async () => ({ kind: 'missing' as const }),
    create: async () => ({
      kind: 'ready' as const,
      value: { id: 'a', title: 'Stale' },
    }),
    remove,
    inspectRemoval,
    rename: async (id: string, title: string) => ({
      kind: 'ready' as const,
      value: { id, title },
    }),
    setPinned: async () => ({ kind: 'failed' as const }),
    setArchived: async () => ({ kind: 'failed' as const }),
    setPinnedOrder: async () => ({ kind: 'failed' as const }),
  };
  const app = createApplication({
    directory: directory as unknown as import('./contracts.js').ThreadDirectory,
    history: {
      currentUrl: () => 'http://localhost/',
      push: () => {},
      subscribe: () => () => {},
    },
    apiUrl: 'http://localhost/api',
    assistantId: 'test',
  });
  return {
    app,
    remove: () => Reflect.get(app, 'remove'),
    check: () => Reflect.get(app, 'checkRemoval'),
    deletion: () => Reflect.get(app.getSnapshot(), 'deletion'),
  };
}
test('deletion reserves globally, preserves rows until confirmed and tombstones stale reads and creation', async () => {
  let finish!: (value: unknown) => void;
  let calls = 0;
  const f = fixture(async (id) => {
    calls++;
    return new Promise((done) => {
      finish = done;
    });
  });
  assert.equal(typeof f.remove(), 'function');
  f.app.start();
  await tick();
  let reentered = false;
  f.app.subscribe(() => {
    if (f.deletion().status === 'pending') {
      reentered = true;
      void f.remove()('b');
    }
  });
  const pending = f.remove()('a');
  assert.equal(reentered, true);
  assert.equal(calls, 1);
  assert.equal(f.app.getSnapshot().list.rows.length, 2);
  assert.equal(await f.app.rename('a', 'Blocked'), false);
  assert.equal(await f.app.rename('b', 'Other'), true);
  assert.equal(f.app.canReorderPinned(), false);
  finish({ kind: 'ready', value: { id: 'a' } });
  assert.equal(await pending, true);
  assert.equal(f.deletion().status, 'confirmed');
  assert.ok(Object.isFrozen(f.deletion()));
  assert.deepEqual(
    f.app.getSnapshot().list.rows.map((r) => r.id),
    ['b']
  );
  f.app.refresh();
  await tick();
  assert.deepEqual(
    f.app.getSnapshot().list.rows.map((r) => r.id),
    ['b']
  );
  f.app.select('a');
  await tick();
  assert.equal(f.app.getSnapshot().selection.status, 'missing');
  f.app.newConversation();
  await tick();
  assert.notEqual(f.app.getSnapshot().creation.status, 'confirmed');
  f.app.dispose();
});
test('deletion uncertainty requires explicit captured inspection; positive metadata preserves loaded slice', async () => {
  let inspections = 0;
  const f = fixture(
    async () => ({ kind: 'failed' }),
    async () => {
      inspections++;
      return {
        kind: 'ready',
        value: { id: 'a', title: 'Fresh', archived: true },
      };
    }
  );
  assert.equal(typeof f.remove(), 'function');
  f.app.start();
  await tick();
  assert.equal(await f.remove()('a'), false);
  const state = f.deletion();
  f.app.refresh();
  await tick();
  assert.equal(f.deletion(), state);
  assert.equal(await f.remove()('b'), false);
  assert.equal(await f.check()('a', state.intent + 1), false);
  assert.equal(inspections, 0);
  assert.equal(await f.check()('a', state.intent), true);
  assert.equal(inspections, 1);
  assert.equal(f.deletion().status, 'idle');
  assert.equal(f.app.getSnapshot().list.rows[0].title, 'Fresh');
  assert.equal(await f.check()('a', state.intent), false);
  f.app.dispose();
});

function selectedFixture(
  status = 'idle',
  reconnect?: { runId: string },
  hooks: {
    factory?: () => void;
    push?: () => void;
    read?: () => void;
    update?: () => void;
  } = {}
) {
  let runtime = {
    status,
    reconnect,
    history: [],
    interrupts: [] as { id: string; value: unknown }[],
    messages: [],
    toolCalls: [],
  };
  let dispatches = 0;
  let removals = 0;
  let disposals = 0,
    gets = 0,
    loads = 0,
    contentDisposals = 0;
  let release!: (value: unknown) => void;
  const pending = new Promise((done) => {
    release = done;
  });
  let notify = () => {};
  const session = {
    getSnapshot: () => {
      hooks.read?.();
      return runtime;
    },
    subscribe: (callback: () => void) => {
      notify = callback;
      return () => {};
    },
    load: async () => {
      loads++;
    },
    dispose: async () => {
      disposals++;
    },
    submit: async () => {
      dispatches++;
      return 'success';
    },
    resume: async () => {
      dispatches++;
      return 'success';
    },
  };
  let url = 'http://localhost/?thread=a';
  const directory = {
    get: async (id: string) => {
      gets++;
      return { kind: 'ready' as const, value: { id, title: id } };
    },
    list: async () => ({
      kind: 'ready' as const,
      value: [
        { id: 'a', title: 'Alpha' },
        { id: 'b', title: 'Beta' },
      ],
    }),
    create: async () => ({
      kind: 'ready' as const,
      value: { id: 'a', title: 'Stale' },
    }),
    remove: async () => {
      removals++;
      return pending;
    },
    inspectRemoval: async () => ({
      kind: 'ready' as const,
      value: { id: 'a', title: 'Fresh' },
    }),
    rename: async () => new Promise(() => {}),
  };
  const app = createApplication({
    directory: directory as unknown as import('./contracts.js').ThreadDirectory,
    history: {
      currentUrl: () => url,
      push: (next) => {
        url = next;
        hooks.push?.();
      },
      subscribe: () => () => {},
    },
    apiUrl: 'http://localhost/api',
    assistantId: 'test',
    sessionFactory: () => {
      hooks.factory?.();
      return session as unknown as import('./application.js').ApplicationSession;
    },
    contentFactory: () => ({
      getSnapshot: () => [],
      update: () => {
        hooks.update?.();
      },
      dispose: () => {
        contentDisposals++;
      },
    }),
  });
  return {
    app,
    remove: () => Reflect.get(app, 'remove'),
    check: () => Reflect.get(app, 'checkRemoval'),
    state: () => Reflect.get(app.getSnapshot(), 'deletion'),
    release,
    session,
    notify: () => notify(),
    setRuntime: (next: typeof runtime) => {
      runtime = next;
    },
    runtime: () => runtime,
    counts: () => ({
      disposals,
      gets,
      loads,
      contentDisposals,
      dispatches,
      removals,
    }),
    url: () => url,
  };
}
for (const [status, reconnect] of [
  ['running', undefined],
  ['idle', { runId: 'remote' }],
  ['error', { runId: 'remote' }],
] as const)
  test(`deletion refuses live selected ${status} retained ${!!reconnect}`, async () => {
    const f = selectedFixture(status, reconnect);
    assert.equal(typeof f.remove(), 'function');
    f.app.start();
    await tick();
    assert.equal(Reflect.get(f.app, 'canRemove')('a'), false);
    assert.equal(await f.remove()('a'), false);
    assert.equal(f.state().status, 'idle');
    f.app.dispose();
  });
test('deletion selected pending fences writes; presence keeps runtime/content; confirmed retires once', async () => {
  const f = selectedFixture();
  assert.equal(typeof f.remove(), 'function');
  f.app.start();
  await tick();
  const before = f.app.getSnapshot();
  const removing = f.remove()('a');
  assert.equal(f.app.canSubmit(), false);
  assert.equal(f.app.submit('blocked'), false);
  assert.equal(f.counts().disposals, 0);
  f.release({ kind: 'failed' });
  assert.equal(await removing, false);
  const intent = f.state().intent;
  assert.equal(await f.check()('a', intent), true);
  assert.equal(f.app.getSnapshot().runtime, before.runtime);
  assert.equal(f.counts().loads, 1);
  assert.equal(f.app.canSubmit(), true);
  f.app.dispose();
  assert.equal(f.counts().disposals, 1);
});
test('deletion confirms selected idle atomically and explicit retired navigation performs no read', async () => {
  const f = selectedFixture();
  assert.equal(typeof f.remove(), 'function');
  f.app.start();
  await tick();
  const removing = f.remove()('a');
  f.release({ kind: 'ready', value: { id: 'a' } });
  assert.equal(await removing, true);
  assert.equal(f.app.getSnapshot().selection.status, 'empty');
  assert.equal(f.app.getSnapshot().runtime, null);
  assert.equal(f.counts().disposals, 1);
  f.app.select('a');
  await tick();
  assert.equal(f.app.getSnapshot().selection.status, 'missing');
  assert.equal(f.counts().gets, 1);
  assert.equal(f.counts().loads, 1);
  f.app.dispose();
  assert.equal(f.counts().disposals, 1);
});
test('deletion nonselected confirmation retains running selected admission by identity', async () => {
  const f = selectedFixture('running');
  assert.equal(typeof f.remove(), 'function');
  f.app.start();
  await tick();
  const before = f.app.getSnapshot();
  const removing = f.remove()('b');
  f.release({ kind: 'ready', value: { id: 'b' } });
  assert.equal(await removing, true);
  const after = f.app.getSnapshot();
  for (const key of ['runtime', 'messages', 'submission', 'selection'] as const)
    assert.equal(after[key], before[key]);
  assert.equal(f.counts().disposals, 0);
  f.app.dispose();
});
test('deletion disposal aborts transport and ignores late confirmation', async () => {
  let signal: AbortSignal | undefined;
  let release!: (value: unknown) => void;
  const f = fixture(async (_id, owned) => {
    signal = owned;
    return new Promise((done) => {
      release = done;
    });
  });
  assert.equal(typeof f.remove(), 'function');
  f.app.start();
  await tick();
  const removing = f.remove()('a');
  const before = f.app.getSnapshot();
  f.app.dispose();
  assert.equal(signal?.aborted, true);
  release({ kind: 'ready', value: { id: 'a' } });
  assert.equal(await removing, false);
  assert.equal(f.app.getSnapshot(), before);
});

test('deletion revalidates metadata reservation entered by live snapshot getter', async () => {
  let enter = false;
  let f: ReturnType<typeof selectedFixture>;
  f = selectedFixture('idle', undefined, {
    read: () => {
      if (enter) {
        enter = false;
        void f.app.rename('a', 'Concurrent');
      }
    },
  });
  f.app.start();
  await tick();
  enter = true;
  assert.equal(Reflect.get(f.app, 'canRemove')('a'), false);
  f.app.dispose();
});
test('deletion runtime observer fences content update after snapshot getter selects replacement', async () => {
  let enter = false;
  let updates = 0;
  let f: ReturnType<typeof selectedFixture>;
  f = selectedFixture('idle', undefined, {
    read: () => {
      if (enter) {
        enter = false;
        f.app.select(null);
      }
    },
    update: () => {
      updates++;
    },
  });
  f.app.start();
  await tick();
  const before = updates;
  enter = true;
  f.notify();
  assert.equal(updates, before);
  assert.equal(f.app.getSnapshot().selection.status, 'empty');
  f.app.dispose();
});
test('deletion history reentry preserves replacement selection after retirement', async () => {
  let enter = false;
  let f: ReturnType<typeof selectedFixture>;
  f = selectedFixture('idle', undefined, {
    push: () => {
      if (enter) {
        enter = false;
        f.app.select('b');
      }
    },
  });
  f.app.start();
  await tick();
  const removing = f.remove()('a');
  enter = true;
  f.release({ kind: 'ready', value: { id: 'a' } });
  assert.equal(await removing, true);
  await tick();
  assert.equal(f.app.getSnapshot().selection.id, 'b');
  assert.equal(f.app.getSnapshot().selection.status, 'ready');
  assert.equal(f.counts().disposals, 1);
  f.app.dispose();
});
test('deletion stale inspection token cannot inspect a newer same-ID barrier', async () => {
  let inspections = 0;
  const f = fixture(
    async () => ({ kind: 'failed' }),
    async () => {
      inspections++;
      return { kind: 'ready', value: { id: 'a', title: 'Fresh' } };
    }
  );
  f.app.start();
  await tick();
  await f.remove()('a');
  const old = f.deletion().intent;
  await f.check()('a', old);
  await f.remove()('a');
  assert.equal(await f.check()('a', old), false);
  assert.equal(inspections, 1);
  f.app.dispose();
});

for (const outcome of [
  { kind: 'ready', value: { id: 'wrong' } },
  { kind: 'cancelled' },
] as const)
  test(`deletion ${outcome.kind} mismatched/unsupported evidence keeps barrier`, async () => {
    const f = fixture(
      async () => outcome,
      async () => ({ kind: 'missing', id: 'wrong' })
    );
    f.app.start();
    await tick();
    assert.equal(await f.remove()('a'), false);
    const intent = f.deletion().intent;
    assert.equal(await f.check()('a', intent), false);
    assert.equal(f.deletion().status, 'unconfirmed');
    assert.equal(f.app.getSnapshot().list.rows.length, 2);
    f.app.dispose();
  });
test('deletion explicit absence retires target with single inspection reservation and ignores late disposal', async () => {
  let finish!: (value: unknown) => void;
  let calls = 0;
  const f = fixture(
    async () => ({ kind: 'failed' }),
    async () => {
      calls++;
      return new Promise((done) => {
        finish = done;
      });
    }
  );
  f.app.start();
  await tick();
  await f.remove()('a');
  const intent = f.deletion().intent;
  const checking = f.check()('a', intent);
  assert.equal(f.deletion().checking, true);
  assert.equal(await f.check()('a', intent), false);
  assert.equal(calls, 1);
  finish({ kind: 'missing', id: 'a' });
  assert.equal(await checking, true);
  assert.equal(f.deletion().status, 'confirmed');
  assert.deepEqual(
    f.app.getSnapshot().list.rows.map((row) => row.id),
    ['b']
  );
  f.app.dispose();
});
test('deletion aborts explicit inspection on disposal without adopting its late result', async () => {
  let inspectSignal: AbortSignal | undefined;
  let finish!: (value: import('./contracts.js').RemovalInspection) => void;
  const directory = {
    list: async () => ({
      kind: 'ready' as const,
      value: [{ id: 'a', title: 'A' }],
    }),
    get: async () => ({ kind: 'missing' as const }),
    create: async () => ({ kind: 'failed' as const }),
    remove: async () => ({ kind: 'failed' as const }),
    inspectRemoval: async (_id: string, signal: AbortSignal) => {
      inspectSignal = signal;
      return new Promise<import('./contracts.js').RemovalInspection>((done) => {
        finish = done;
      });
    },
  };
  const app = createApplication({
    directory,
    history: {
      currentUrl: () => 'http://localhost/',
      push: () => {},
      subscribe: () => () => {},
    },
    apiUrl: 'http://localhost/api',
    assistantId: 'test',
  });
  app.start();
  await tick();
  await app.remove('a');
  const checking = app.checkRemoval('a', app.getSnapshot().deletion.intent);
  const before = app.getSnapshot();
  app.dispose();
  assert.equal(inspectSignal?.aborted, true);
  finish({ kind: 'missing', id: 'a' });
  assert.equal(await checking, false);
  assert.equal(app.getSnapshot(), before);
});
test('deletion tombstone rejects an older pending lookup and preserves replacement selection', async () => {
  let finishGet!: (value: import('./contracts.js').ThreadLookupResult) => void;
  let finishDelete!: (
    value: import('./contracts.js').DirectoryResult<{ id: string }>
  ) => void;
  let sessions = 0;
  const directory = {
    list: async () => ({
      kind: 'ready' as const,
      value: [
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
      ],
    }),
    get: async (id: string) =>
      id === 'a'
        ? new Promise<import('./contracts.js').ThreadLookupResult>((done) => {
            finishGet = done;
          })
        : { kind: 'missing' as const },
    create: async () => ({ kind: 'failed' as const }),
    remove: async () =>
      new Promise<import('./contracts.js').DirectoryResult<{ id: string }>>(
        (done) => {
          finishDelete = done;
        }
      ),
    inspectRemoval: async () => ({ kind: 'failed' as const }),
  };
  const app = createApplication({
    directory,
    history: {
      currentUrl: () => 'http://localhost/',
      push: () => {},
      subscribe: () => () => {},
    },
    apiUrl: 'http://localhost/api',
    assistantId: 'test',
    sessionFactory: () => {
      sessions++;
      throw new Error('No stale session allowed');
    },
  });
  app.start();
  await tick();
  const removing = app.remove('a');
  app.select('a');
  assert.equal(app.canSubmit(), false);
  finishDelete({ kind: 'ready', value: { id: 'a' } });
  assert.equal(await removing, true);
  app.select('b');
  await tick();
  const before = app.getSnapshot().selection;
  finishGet({ kind: 'ready', value: { id: 'a', title: 'Stale' } });
  await tick();
  assert.equal(app.getSnapshot().selection, before);
  assert.equal(sessions, 0);
  app.dispose();
});

test('deletion refuses a local submission reserved by the live snapshot getter', async () => {
  let enter = false;
  let f: ReturnType<typeof selectedFixture>;
  f = selectedFixture('idle', undefined, {
    read: () => {
      if (enter) {
        enter = false;
        assert.equal(f.app.submit('racing'), true);
      }
    },
  });
  f.app.start();
  await tick();
  enter = true;
  const removing = f.remove()('a');
  assert.equal(f.counts().removals, 0);
  assert.equal(await removing, false);
  assert.equal(f.counts().dispatches, 1);
  f.app.dispose();
});
for (const boundary of [1, 2])
  test(`deletion reserved by submit live getter boundary ${boundary} blocks runtime dispatch`, async () => {
    let countdown = 0;
    let removing: Promise<boolean> | undefined;
    let f: ReturnType<typeof selectedFixture>;
    f = selectedFixture('idle', undefined, {
      read: () => {
        if (countdown && !--countdown) removing = f.remove()('a');
      },
    });
    f.app.start();
    await tick();
    countdown = boundary;
    assert.equal(f.app.submit('blocked'), false);
    assert.equal(f.counts().dispatches, 0);
    assert.equal(f.state().status, 'pending');
    f.release({ kind: 'failed' });
    await removing;
    f.app.dispose();
  });
test('deletion reserved by final decision getter blocks resume dispatch', async () => {
  let countdown = 0;
  let removing: Promise<boolean> | undefined;
  let f: ReturnType<typeof selectedFixture>;
  f = selectedFixture('idle', undefined, {
    read: () => {
      if (countdown && !--countdown) removing = f.remove()('a');
    },
  });
  f.app.start();
  await tick();
  f.setRuntime({
    ...f.runtime(),
    interrupts: [
      {
        id: 'a'.repeat(32),
        value: { type: 'approval_request', reason: 'Review' },
      },
    ],
  });
  f.notify();
  const decision = f.app.getSnapshot().decision!;
  assert.equal(decision.canRespond, true);
  countdown = 2;
  assert.equal(f.app.respond(decision.token, 'approve'), false);
  assert.equal(f.counts().dispatches, 0);
  f.release({ kind: 'failed' });
  await removing;
  f.app.dispose();
});
for (const action of ['navigate', 'dispose'] as const)
  test(`deletion nonselected retirement survives approval getter ${action} reentry`, async () => {
    let enter = false;
    let f: ReturnType<typeof selectedFixture>;
    f = selectedFixture('idle', undefined, {
      read: () => {
        if (enter) {
          enter = false;
          if (action === 'navigate') f.app.select('c');
          else f.app.dispose();
        }
      },
    });
    f.app.start();
    await tick();
    f.setRuntime({
      ...f.runtime(),
      interrupts: [
        {
          id: 'a'.repeat(32),
          value: { type: 'approval_request', reason: 'Review' },
        },
      ],
    });
    f.notify();
    const removing = f.remove()('b');
    enter = true;
    f.release({ kind: 'ready', value: { id: 'b' } });
    assert.equal(await removing, true);
    await tick();
    assert.equal(
      f.app.getSnapshot().list.rows.some((row) => row.id === 'b'),
      false
    );
    assert.equal(f.state().status, 'confirmed');
    if (action === 'navigate') {
      assert.equal(f.app.getSnapshot().selection.id, 'c');
      assert.equal(f.app.getSnapshot().selection.status, 'ready');
      assert.equal(new URL(f.url()).searchParams.get('thread'), 'c');
    }
    f.app.dispose();
  });
