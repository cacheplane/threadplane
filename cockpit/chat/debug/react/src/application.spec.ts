import { describe, it, expect, vi } from 'vitest';
import type { CompleteOutcome } from '@threadplane/core';
import { createDebugApplication } from './application';
import type { DebugClient, DebugSession } from './connection';
import type { DebugSnapshot } from './authority';
import fixture from './native-semantic.fixture.json';
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export async function tick() {
  for (let i = 0; i < 32; i++) await Promise.resolve();
}
export function setup() {
  let state: DebugSnapshot = {
    status: 'idle',
    messages: [],
    toolCalls: [],
    interrupts: [],
    subgraphs: [],
    history: undefined,
  };
  const listeners = new Set<() => void>();
  let run = deferred<CompleteOutcome>(),
    load = deferred<void>();
  const session = {
    getSnapshot: vi.fn(() => state),
    subscribe: vi.fn((listener: () => void): (() => void) => {
      listeners.add(listener);
      return vi.fn(() => {
        listeners.delete(listener);
      });
    }),
    submit: vi.fn(() => run.promise),
    resume: vi.fn(),
    load: vi.fn(() => load.promise),
    stop: vi.fn(async (): Promise<void> => undefined),
    dispose: vi.fn(async (): Promise<void> => undefined),
  };
  const client = {
    createThread: vi.fn(async () => fixture.turns[0].checkpoint.thread_id),
    sessionFactory: vi.fn(async () => session as unknown as DebugSession),
    readCurrent: vi.fn(async () => copy(fixture.turns[0].rawExact) as unknown),
    readCheckpoint: vi.fn(
      async () => copy(fixture.turns[0].rawExact) as unknown
    ),
    readHistory: vi.fn(
      async () => [copy(fixture.turns[0].rawExact)] as unknown
    ),
  };
  const app = createDebugApplication(client as DebugClient);
  function update(next: DebugSnapshot) {
    state = next;
    for (const notify of [...listeners]) notify();
  }
  function live(index = 0, staticDelivery = false): DebugSnapshot {
    const t = fixture.turns[index],
      prefix = index ? fixture.turns[index - 1].semantic.length : 0;
    return {
      status: 'idle',
      messages: t.semantic.map((m, i) => ({
        ...m,
        delivery: {
          generation: staticDelivery ? m.id : i < prefix ? m.id : t.generation,
          phase: 'complete',
          outcome: 'success',
        },
      })),
      toolCalls: [],
      interrupts: [],
      subgraphs: [],
      values: { analysis: copy(t.analysis) },
      history: staticDelivery
        ? [{ checkpoint: copy(t.checkpoint), next: [], tasks: [] }]
        : index
        ? [
            {
              checkpoint: copy(fixture.turns[0].checkpoint),
              next: [],
              tasks: [],
            },
          ]
        : undefined,
    };
  }
  async function begin(index = 0) {
    run = deferred<CompleteOutcome>();
    load = deferred<void>();
    client.readCurrent.mockResolvedValue(copy(fixture.turns[index].rawExact));
    client.readCheckpoint.mockResolvedValue(
      copy(fixture.turns[index].rawExact)
    );
    const pending = app.submit(fixture.turns[index].input);
    await tick();
    const full = live(index),
      n = index ? fixture.turns[index - 1].semantic.length : 0;
    update({
      ...full,
      status: 'running',
      messages: full.messages.slice(0, n + 1),
    });
    return { pending };
  }
  async function finishLive(index = 0) {
    update(live(index));
    run.resolve('success');
    await tick();
  }
  async function finishLoad(index = 0) {
    update(live(index, true));
    load.resolve();
    await tick();
  }
  async function confirmed(index = 0) {
    const { pending } = await begin(index);
    await finishLive(index);
    await finishLoad(index);
    await pending;
  }
  return {
    app,
    client,
    session,
    listeners,
    update,
    live,
    begin,
    finishLive,
    finishLoad,
    confirmed,
    get run() {
      return run;
    },
    get load() {
      return load;
    },
  };
}

describe('debug conversation owner', () => {
  it('mount and New alone are lazy, snapshots stable and context changes synchronously', async () => {
    const h = setup(),
      initial = h.app.getSnapshot();
    expect(h.app.getSnapshot()).toBe(initial);
    const next = h.app.newConversation();
    expect(h.app.getSnapshot().contextKey).not.toBe(initial.contextKey);
    await next;
    expect(h.client.createThread).not.toHaveBeenCalled();
    expect(h.app.getSnapshot().canSubmit).toBe(true);
  });
  it('subscribes before submit and confirms actual two native HABC generations with explicit load only after exact read', async () => {
    const h = setup();
    const { pending } = await h.begin();
    expect(h.session.subscribe.mock.invocationCallOrder[0]).toBeLessThan(
      h.session.submit.mock.invocationCallOrder[0]
    );
    expect(h.app.getSnapshot().canSubmit).toBe(false);
    await h.finishLive();
    expect(h.app.getSnapshot().activity).toBe('confirming');
    expect(h.session.load).toHaveBeenCalledTimes(1);
    expect(h.client.readCheckpoint.mock.invocationCallOrder[0]).toBeLessThan(
      h.session.load.mock.invocationCallOrder[0]
    );
    await h.finishLoad();
    await pending;
    expect(h.app.getSnapshot().rows.map((r) => r.message.content)).toEqual(
      fixture.turns[0].semantic.map((m) => m.content)
    );
    expect(h.app.getSnapshot().current).toEqual({
      contextKey: h.app.getSnapshot().contextKey,
      status: 'ready',
      values: { analysis: fixture.turns[0].analysis },
    });
    expect(h.app.getSnapshot().canSubmit).toBe(true);
    await h.confirmed(1);
    expect(h.app.getSnapshot().rows).toHaveLength(8);
    expect(h.client.createThread).toHaveBeenCalledTimes(1);
  });
  it('rejects every concurrent author/read action before SDK effects', async () => {
    const h = setup();
    const { pending } = await h.begin();
    const calls = h.session.submit.mock.calls.length;
    await h.app.submit('duplicate');
    await h.app.refresh({
      contextKey: h.app.getSnapshot().contextKey,
      pageGeneration: null,
    });
    await h.app.inspect({
      contextKey: h.app.getSnapshot().contextKey,
      pageGeneration: 0,
      rowKey: 'none',
    });
    expect(h.session.submit).toHaveBeenCalledTimes(calls);
    expect(h.client.readHistory).not.toHaveBeenCalled();
    await h.finishLive();
    await h.finishLoad();
    await pending;
  });
  it.each(['current', 'exact', 'reload', 'generation', 'omitted-B'] as const)(
    'saved confirmation rejects %s and requires New',
    async (kind) => {
      const h = setup();
      const { pending } = await h.begin();
      if (kind === 'current')
        h.client.readCurrent.mockRejectedValueOnce(Error('private credential'));
      if (kind === 'exact')
        h.client.readCheckpoint.mockResolvedValueOnce({
          ...copy(fixture.turns[0].rawExact),
          checkpoint: {
            ...fixture.turns[0].checkpoint,
            checkpoint_id: 'other',
          },
        });
      let live = h.live();
      if (kind === 'generation')
        live = {
          ...live,
          messages: live.messages.map((m, i) =>
            i === 2
              ? {
                  ...(m as object),
                  delivery: {
                    generation: 'other',
                    phase: 'complete',
                    outcome: 'success',
                  },
                }
              : m
          ),
        };
      if (kind === 'omitted-B')
        live = { ...live, messages: live.messages.filter((_, i) => i !== 2) };
      h.update(live);
      h.run.resolve('success');
      await tick();
      if (kind === 'reload') {
        h.update({ ...h.live(0, true), history: [] });
        h.load.resolve();
      } else {
        h.update(h.live(0, true));
        h.load.resolve();
      }
      await pending;
      expect(h.app.getSnapshot().canSubmit).toBe(false);
      expect(h.app.getSnapshot().confirmed).toBe(false);
      expect(h.app.getSnapshot().error).not.toContain('credential');
      await h.app.submit('blocked');
      expect(h.session.submit).toHaveBeenCalledTimes(1);
    }
  );
  it('requires a first running H publication, not a terminal-only transcript', async () => {
    const h = setup();
    const pending = h.app.submit(fixture.turns[0].input);
    await tick();
    h.update(h.live());
    h.run.resolve('success');
    await pending;
    expect(h.app.getSnapshot().canSubmit).toBe(false);
    expect(h.session.load).not.toHaveBeenCalled();
  });
  it('rejects reuse of the previous live generation', async () => {
    const h = setup();
    await h.confirmed();
    const { pending } = await h.begin(1);
    let x = h.live(1);
    x = {
      ...x,
      messages: x.messages.map((m, i) =>
        i < 4
          ? m
          : {
              ...(m as object),
              delivery: {
                generation: fixture.turns[0].generation,
                phase: 'complete',
                outcome: 'success',
              },
            }
      ),
    };
    h.update({ ...x, status: 'running', messages: x.messages.slice(0, 5) });
    h.update(x);
    h.run.resolve('success');
    await tick();
    h.load.resolve();
    await pending;
    expect(h.app.getSnapshot().canSubmit).toBe(false);
  });
  it('failed second confirmation retains and labels the last confirmed transcript/current observation', async () => {
    const h = setup();
    await h.confirmed();
    const before = h.app.getSnapshot();
    const { pending } = await h.begin(1);
    h.client.readCurrent.mockRejectedValueOnce(Error('failure'));
    await h.finishLive(1);
    await pending;
    expect(h.app.getSnapshot().rows.map((r) => r.message.content)).toEqual(
      before.rows.map((r) => r.message.content)
    );
    expect(h.app.getSnapshot().current).toBe(before.current);
    expect(h.app.getSnapshot().confirmed).toBe(false);
    expect(h.app.getSnapshot().error).toContain('Last confirmed');
  });
  it('refresh is direct history, preserves order, never loads, and invalidates prior row tuples', async () => {
    const h = setup();
    await h.confirmed();
    const before = h.app.getSnapshot();
    h.client.readHistory.mockResolvedValueOnce([
      copy(fixture.turns[0].rawExact),
      copy(fixture.turns[1].rawExact),
    ]);
    await h.app.refresh({
      contextKey: before.contextKey,
      pageGeneration: before.checkpointPage?.pageGeneration ?? null,
    });
    const page = h.app.getSnapshot().checkpointPage!;
    expect(page.rows.map((r) => r.label)).toEqual(
      fixture.turns.map((t) => t.checkpoint.checkpoint_id)
    );
    expect(h.session.load).toHaveBeenCalledTimes(1);
    await h.app.inspect({
      contextKey: page.contextKey,
      pageGeneration: page.pageGeneration - 1,
      rowKey: page.rows[0].rowKey,
    });
    expect(h.client.readCheckpoint).toHaveBeenCalledTimes(1);
  });
  it.each(['failed', 'mismatch', 'overbudget'] as const)(
    'inspection %s retains current transcript and authoring',
    async (kind) => {
      const h = setup();
      await h.confirmed();
      const before = h.app.getSnapshot(),
        page = before.checkpointPage!;
      const selected = {
        contextKey: page.contextKey,
        pageGeneration: page.pageGeneration,
        rowKey: page.rows[0].rowKey,
      };
      if (kind === 'failed')
        h.client.readCheckpoint.mockRejectedValueOnce(Error('secret'));
      if (kind === 'mismatch')
        h.client.readCheckpoint.mockResolvedValueOnce({
          ...copy(fixture.turns[0].rawExact),
          checkpoint: {
            ...fixture.turns[0].checkpoint,
            checkpoint_map: { '': 'other' },
          },
        });
      if (kind === 'overbudget')
        h.client.readCheckpoint.mockResolvedValueOnce({
          ...copy(fixture.turns[0].rawExact),
          values: { analysis: 'x'.repeat(2001) },
        });
      await h.app.inspect(selected);
      const after = h.app.getSnapshot();
      expect(after.inspection.status).toBe(
        kind === 'overbudget' ? 'unavailable' : 'error'
      );
      expect(after.rows).toBe(before.rows);
      expect(after.current).toBe(before.current);
      expect(after.canSubmit).toBe(true);
      expect(after.selection).toEqual(selected);
    }
  );
  it('inspection owns bounded nonmessages only, with the complete selection tuple', async () => {
    const h = setup();
    await h.confirmed();
    const page = h.app.getSnapshot().checkpointPage!;
    const selection = {
      contextKey: page.contextKey,
      pageGeneration: page.pageGeneration,
      rowKey: page.rows[0].rowKey,
    };
    const raw = copy(fixture.turns[0].rawExact);
    h.client.readCheckpoint.mockResolvedValueOnce(raw);
    await h.app.inspect(selection);
    const s = h.app.getSnapshot();
    expect(s.inspection).toEqual({
      status: 'ready',
      selection,
      values: { analysis: fixture.turns[0].analysis },
    });
    raw.values.analysis.words = 999;
    expect(h.app.getSnapshot()).toBe(s);
    expect(JSON.stringify(s.inspection)).not.toContain('messages');
  });
  it.each(['refresh', 'inspect'] as const)(
    'Stop during %s aborts read only and waits for ignored abort',
    async (kind) => {
      const h = setup();
      await h.confirmed();
      const before = h.app.getSnapshot(),
        page = before.checkpointPage!,
        held = deferred<unknown>();
      h.client.readHistory.mockReturnValueOnce(held.promise);
      h.client.readCheckpoint.mockReturnValueOnce(held.promise);
      const pending =
        kind === 'refresh'
          ? h.app.refresh({
              contextKey: page.contextKey,
              pageGeneration: page.pageGeneration,
            })
          : h.app.inspect({
              contextKey: page.contextKey,
              pageGeneration: page.pageGeneration,
              rowKey: page.rows[0].rowKey,
            });
      await tick();
      const stopped = h.app.stop();
      await tick();
      expect(h.app.getSnapshot().busy).toBe(true);
      expect(h.session.stop).not.toHaveBeenCalled();
      expect(h.session.dispose).not.toHaveBeenCalled();
      held.resolve(
        kind === 'refresh'
          ? [copy(fixture.turns[0].rawExact)]
          : copy(fixture.turns[0].rawExact)
      );
      await pending;
      await stopped;
      expect(h.app.getSnapshot().current).toBe(before.current);
      expect(h.app.getSnapshot().canSubmit).toBe(true);
      expect(h.app.getSnapshot().busy).toBe(false);
    }
  );
  it('history failure retains the last page and confirmed authority, clearing selection', async () => {
    const h = setup();
    await h.confirmed();
    const before = h.app.getSnapshot(),
      page = before.checkpointPage!;
    await h.app.inspect({
      contextKey: page.contextKey,
      pageGeneration: page.pageGeneration,
      rowKey: page.rows[0].rowKey,
    });
    h.client.readHistory.mockRejectedValueOnce(Error('secret'));
    await h.app.refresh({
      contextKey: page.contextKey,
      pageGeneration: page.pageGeneration,
    });
    expect(h.app.getSnapshot().checkpointPage).toBe(page);
    expect(h.app.getSnapshot().selection).toBeUndefined();
    expect(h.app.getSnapshot().canSubmit).toBe(true);
  });
  it.each([
    'thread',
    'session',
    'submit',
    'current',
    'exact',
    'load',
    'refresh',
    'inspect',
  ] as const)(
    'New synchronously revokes and awaits late %s work',
    async (phase) => {
      const h = setup(),
        held = deferred<unknown>();
      let pending: Promise<unknown>;
      if (phase === 'thread')
        h.client.createThread.mockReturnValueOnce(
          held.promise as Promise<string>
        );
      if (phase === 'session')
        h.client.sessionFactory.mockReturnValueOnce(
          held.promise as Promise<DebugSession>
        );
      if (phase === 'refresh' || phase === 'inspect') {
        await h.confirmed();
        const page = h.app.getSnapshot().checkpointPage!;
        if (phase === 'refresh') {
          h.client.readHistory.mockReturnValueOnce(held.promise);
          pending = h.app.refresh({
            contextKey: page.contextKey,
            pageGeneration: page.pageGeneration,
          });
        } else {
          h.client.readCheckpoint.mockReturnValueOnce(held.promise);
          pending = h.app.inspect({
            contextKey: page.contextKey,
            pageGeneration: page.pageGeneration,
            rowKey: page.rows[0].rowKey,
          });
        }
      } else if (phase === 'thread' || phase === 'session') {
        pending = h.app.submit(fixture.turns[0].input);
      } else {
        const started = await h.begin();
        pending = started.pending;
        if (phase === 'current')
          h.client.readCurrent.mockReturnValueOnce(held.promise);
        if (phase === 'exact')
          h.client.readCheckpoint.mockReturnValueOnce(held.promise);
        if (phase !== 'submit') await h.finishLive();
      }
      await tick();
      const old = h.app.getSnapshot().contextKey;
      let settled = false;
      const replacing = h.app.newConversation().then(() => {
        settled = true;
      });
      expect(h.app.getSnapshot().contextKey).not.toBe(old);
      expect(h.app.getSnapshot().rows).toHaveLength(0);
      expect(h.app.getSnapshot().current.status).toBe('unknown');
      await tick();
      expect(settled).toBe(false);
      expect(h.app.getSnapshot().canSubmit).toBe(false);
      held.resolve(
        phase === 'thread'
          ? fixture.turns[0].checkpoint.thread_id
          : phase === 'session'
          ? h.session
          : phase === 'refresh'
          ? [fixture.turns[0].rawExact]
          : fixture.turns[0].rawExact
      );
      h.run.resolve('success');
      h.load.resolve();
      await pending!;
      await replacing;
      expect(h.app.getSnapshot().rows).toHaveLength(0);
      expect(h.app.getSnapshot().canSubmit).toBe(true);
      if (phase === 'session')
        expect(h.session.dispose).toHaveBeenCalledTimes(1);
    }
  );
  it('New during reentrant admission publication tracks acquisition before cleanup drains', async () => {
    const h = setup();
    let replacing: Promise<void> | undefined,
      requested = false;
    const release = h.app.subscribe(() => {
      if (h.app.getSnapshot().busy && !requested) {
        requested = true;
        replacing = h.app.newConversation();
      }
    });
    const pending = h.app.submit('input');
    await tick();
    release();
    await pending;
    await replacing;
    expect(h.client.createThread).not.toHaveBeenCalled();
    expect(h.app.getSnapshot().canSubmit).toBe(true);
  });
  it('dispose is idempotent and awaits late acquired resource cleanup', async () => {
    const h = setup(),
      acquire = deferred<DebugSession>(),
      close = deferred<void>();
    h.client.sessionFactory.mockReturnValueOnce(acquire.promise);
    h.session.dispose.mockReturnValueOnce(close.promise);
    const pending = h.app.submit('input');
    await tick();
    const first = h.app.dispose(),
      second = h.app.dispose();
    expect(first).toBe(second);
    let done = false;
    void first.then(() => {
      done = true;
    });
    acquire.resolve(h.session as unknown as DebugSession);
    await tick();
    expect(done).toBe(false);
    close.resolve();
    await first;
    await pending;
    expect(h.session.dispose).toHaveBeenCalledTimes(1);
    expect(h.app.getSnapshot().canSubmit).toBe(false);
  });
  it('cleanup failure quarantines future authoring even after New', async () => {
    const h = setup();
    const { pending } = await h.begin();
    h.session.dispose.mockRejectedValueOnce(Error('secret'));
    const replacing = h.app.newConversation();
    h.run.resolve('success');
    await pending;
    await replacing;
    await h.app.newConversation();
    expect(h.app.getSnapshot().activity).toBe('cleanup-failed');
    expect(h.app.getSnapshot().canSubmit).toBe(false);
    expect(h.app.getSnapshot().error).not.toContain('secret');
  });
});
it('late subscribe release after reentrant New is released exactly once and failure quarantines', async () => {
  const h = setup(),
    release = vi.fn(() => {
      throw Error('late release failed');
    });
  let replacing: Promise<void> | undefined;
  h.session.subscribe.mockImplementationOnce(() => {
    replacing = h.app.newConversation();
    return release;
  });
  await h.app.submit('input');
  await replacing;
  expect(release).toHaveBeenCalledTimes(1);
  expect(h.session.dispose).toHaveBeenCalledTimes(1);
  expect(h.app.getSnapshot().activity).toBe('cleanup-failed');
});
it('captures client capabilities once so a replaced reentrant getter cannot dispatch revoked work', async () => {
  const h = setup(),
    forbidden = vi.fn(async () => fixture.turns[0].rawExact);
  await h.confirmed();
  Object.defineProperty(h.client, 'readHistory', {
    enumerable: true,
    configurable: true,
    get() {
      void h.app.newConversation();
      return forbidden;
    },
  });
  const before = h.app.getSnapshot();
  await h.app.refresh({
    contextKey: before.contextKey,
    pageGeneration: before.checkpointPage?.pageGeneration ?? null,
  });
  expect(forbidden).not.toHaveBeenCalled();
});
it('dispose synchronously clears owned inspector and conversation data before native cleanup', async () => {
  const h = setup();
  await h.confirmed();
  const page = h.app.getSnapshot().checkpointPage!;
  await h.app.inspect({
    contextKey: page.contextKey,
    pageGeneration: page.pageGeneration,
    rowKey: page.rows[0].rowKey,
  });
  const disposed = h.app.dispose(),
    s = h.app.getSnapshot();
  expect(s.rows).toHaveLength(0);
  expect(s.current.status).toBe('unknown');
  expect(s.checkpointPage).toBeUndefined();
  expect(s.selection).toBeUndefined();
  expect(s.inspection.status).toBe('idle');
  await disposed;
});
it('compact native history captures date and parent metadata without reading tasks or values', async () => {
  const h = setup();
  const { pending } = await h.begin();
  await h.finishLive();
  const state = h.live(0, true),
    tip = {
      checkpoint: fixture.turns[0].checkpoint,
      next: [],
      created_at: 'observed-date',
      parent_checkpoint: {
        ...fixture.turns[0].checkpoint,
        checkpoint_id: 'parent',
      },
    };
  Object.defineProperty(tip, 'tasks', {
    enumerable: true,
    get() {
      throw Error('must not read compact task data');
    },
  });
  Object.defineProperty(tip, 'values', {
    enumerable: true,
    get() {
      throw Error('must not read compact values');
    },
  });
  h.update({ ...state, history: [tip] });
  h.load.resolve();
  await pending;
  expect(h.app.getSnapshot().canSubmit).toBe(true);
  expect(h.app.getSnapshot().checkpointPage?.rows[0]).toMatchObject({
    createdAt: 'observed-date',
    parentLabel: 'parent',
  });
});
it.each(['initial', 'before-submit', 'terminal', 'reload'] as const)(
  'reentrant New from %s native getSnapshot cannot adopt or dispatch later work',
  async (phase) => {
    const h = setup();
    let replacement: Promise<void> | undefined;
    if (phase === 'initial' || phase === 'before-submit') {
      const original = h.session.getSnapshot.getMockImplementation()!;
      let calls = 0;
      h.session.getSnapshot.mockImplementation(() => {
        calls++;
        if (calls === (phase === 'initial' ? 1 : 2))
          replacement = h.app.newConversation();
        return original();
      });
      await h.app.submit('input');
      await replacement;
      expect(h.session.submit).not.toHaveBeenCalled();
    } else {
      const { pending } = await h.begin();
      if (phase === 'reload') await h.finishLive();
      const original = h.session.getSnapshot.getMockImplementation()!;
      h.session.getSnapshot.mockImplementationOnce(() => {
        replacement = h.app.newConversation();
        return original();
      });
      if (phase === 'terminal') {
        h.run.resolve('success');
      } else h.load.resolve();
      await pending;
      await replacement;
      expect(h.app.getSnapshot().current.status).toBe('unknown');
      expect(h.app.getSnapshot().rows).toHaveLength(0);
    }
  }
);
it('current response is owned before waiting for exact read, and reload cannot rescue a changed saved tip', async () => {
  const h = setup(),
    held = deferred<unknown>();
  const { pending } = await h.begin();
  const current = copy(fixture.turns[0].rawExact);
  h.client.readCurrent.mockResolvedValueOnce(current);
  h.client.readCheckpoint.mockReturnValueOnce(held.promise);
  await h.finishLive();
  current.values.messages[1].content = 'mutated while exact read pending';
  current.values.analysis.characters = 123;
  held.resolve(copy(fixture.turns[0].rawExact));
  await tick();
  await h.finishLoad();
  await pending;
  expect(h.app.getSnapshot().canSubmit).toBe(true);
  expect(h.app.getSnapshot().rows[1].message.content).toBe(
    fixture.turns[0].semantic[1].content
  );
});
it('Stop during send revokes execution and awaits late submit before New can author', async () => {
  const h = setup();
  const { pending } = await h.begin();
  let settled = false;
  const stop = h.app.stop().then(() => {
    settled = true;
  });
  await tick();
  expect(settled).toBe(false);
  expect(h.session.stop).toHaveBeenCalledTimes(1);
  expect(h.session.dispose).toHaveBeenCalledTimes(1);
  h.run.resolve('success');
  await pending;
  await stop;
  expect(h.app.getSnapshot().canSubmit).toBe(false);
  await h.app.submit('blocked');
  expect(h.session.submit).toHaveBeenCalledTimes(1);
  await h.app.newConversation();
  expect(h.app.getSnapshot().canSubmit).toBe(true);
});
it('late rejected acquisition cleanup quarantines even when New has already revoked authority', async () => {
  const h = setup(),
    held = deferred<DebugSession>();
  h.client.sessionFactory.mockReturnValueOnce(held.promise);
  const pending = h.app.submit('input');
  await tick();
  const replacing = h.app.newConversation();
  held.reject(Error('Runtime session cleanup failed.'));
  await pending;
  await replacing;
  expect(h.app.getSnapshot().activity).toBe('cleanup-failed');
  expect(h.app.getSnapshot().canSubmit).toBe(false);
});
it('history refresh rejects a previous context even when the old page number and key exist', async () => {
  const h = setup();
  await h.confirmed();
  const old = h.app.getSnapshot(),
    page = old.checkpointPage!;
  await h.app.newConversation();
  await h.app.refresh({
    contextKey: old.contextKey,
    pageGeneration: page.pageGeneration,
  });
  await h.app.inspect({
    contextKey: old.contextKey,
    pageGeneration: page.pageGeneration,
    rowKey: page.rows[0].rowKey,
  });
  expect(h.client.readHistory).not.toHaveBeenCalled();
  expect(h.client.readCheckpoint).toHaveBeenCalledTimes(1);
});
it('listener exceptions cannot prevent New revocation or owned cleanup', async () => {
  const h = setup();
  await h.confirmed();
  h.app.subscribe(() => {
    throw Error('observer failed');
  });
  await h.app.newConversation();
  expect(h.session.dispose).toHaveBeenCalledTimes(1);
  expect(h.app.getSnapshot().canSubmit).toBe(true);
});
it('reads a selected intermediate checkpoint with missing analysis without changing current analysis', async () => {
  const h = setup();
  await h.confirmed();
  const before = h.app.getSnapshot();
  h.client.readHistory.mockResolvedValueOnce([
    {
      checkpoint: {
        ...fixture.turns[0].checkpoint,
        checkpoint_id: 'intermediate',
      },
      next: ['process'],
    },
  ]);
  await h.app.refresh({
    contextKey: before.contextKey,
    pageGeneration: before.checkpointPage!.pageGeneration,
  });
  const p = h.app.getSnapshot().checkpointPage!;
  h.client.readCheckpoint.mockResolvedValueOnce({
    checkpoint: {
      ...fixture.turns[0].checkpoint,
      checkpoint_id: 'intermediate',
    },
    values: { phase: 'generate', messages: [] },
  });
  await h.app.inspect({
    contextKey: p.contextKey,
    pageGeneration: p.pageGeneration,
    rowKey: p.rows[0].rowKey,
  });
  expect(h.app.getSnapshot().inspection).toMatchObject({
    status: 'ready',
    values: { phase: 'generate' },
  });
  expect(h.app.getSnapshot().current).toBe(before.current);
});
it('failed creation requires New before another attempt', async () => {
  const h = setup();
  h.client.createThread.mockRejectedValueOnce(Error('secret'));
  await h.app.submit('input');
  expect(h.app.getSnapshot().canSubmit).toBe(false);
  await h.app.submit('again');
  expect(h.client.createThread).toHaveBeenCalledTimes(1);
  await h.app.newConversation();
  expect(h.app.getSnapshot().canSubmit).toBe(true);
});
it('stopping an inspection clears the pending disclosure while its ignored-abort read settles', async () => {
  const h = setup();
  await h.confirmed();
  const page = h.app.getSnapshot().checkpointPage!,
    held = deferred<unknown>();
  h.client.readCheckpoint.mockReturnValueOnce(held.promise);
  const pending = h.app.inspect({
    contextKey: page.contextKey,
    pageGeneration: page.pageGeneration,
    rowKey: page.rows[0].rowKey,
  });
  await tick();
  const stopping = h.app.stop();
  expect(h.app.getSnapshot().inspection.status).toBe('idle');
  expect(h.app.getSnapshot().selection).toBeUndefined();
  held.resolve(fixture.turns[0].rawExact);
  await pending;
  await stopping;
  expect(h.app.getSnapshot().inspection.status).toBe('idle');
});
it.each(['refresh', 'inspect'] as const)(
  'rejects an accessor-bearing %s request without invoking it or changing context',
  async (kind) => {
    const h = setup();
    await h.confirmed();
    const before = h.app.getSnapshot(),
      page = before.checkpointPage!,
      getter = vi.fn(() => {
        void h.app.newConversation();
        return before.contextKey;
      });
    const request = {
      pageGeneration: page.pageGeneration,
      rowKey: page.rows[0].rowKey,
    };
    Object.defineProperty(request, 'contextKey', {
      enumerable: true,
      get: getter,
    });
    if (kind === 'refresh')
      await h.app.refresh(
        request as unknown as Parameters<typeof h.app.refresh>[0]
      );
    else
      await h.app.inspect(
        request as unknown as Parameters<typeof h.app.inspect>[0]
      );
    expect(getter).not.toHaveBeenCalled();
    expect(h.app.getSnapshot()).toBe(before);
    expect(h.client.readHistory).not.toHaveBeenCalled();
    expect(h.client.readCheckpoint).toHaveBeenCalledTimes(1);
  }
);
it.each([false, true])(
  'New awaits a promise-returning unsubscribe and quarantines rejection (late=%s)',
  async (late) => {
    const h = setup(),
      held = deferred<void>();
    let replacement: Promise<void> | undefined;
    const release = vi.fn(async () => {
      await held.promise;
    });
    h.session.subscribe.mockImplementationOnce((notify) => {
      h.listeners.add(notify);
      if (late) replacement = h.app.newConversation();
      return release;
    });
    let pending: Promise<unknown>;
    if (late) {
      pending = h.app.submit('input');
    } else {
      await h.confirmed();
      pending = Promise.resolve();
      replacement = h.app.newConversation();
    }
    await tick();
    let settled = false;
    void replacement?.then(() => {
      settled = true;
    });
    await tick();
    expect(settled).toBe(false);
    held.reject(Error('unsubscribe failed'));
    await pending;
    await replacement;
    expect(release).toHaveBeenCalledTimes(1);
    expect(h.app.getSnapshot().activity).toBe('cleanup-failed');
  }
);
it.each(['stop', 'new'] as const)(
  'New refreshes context and preserves latest intent during held %s cleanup',
  async (first) => {
    const h = setup();
    await h.confirmed();
    const held = deferred<void>();
    h.session.dispose.mockReturnValueOnce(held.promise);
    let send: Promise<void> | undefined;
    if (first === 'stop') {
      const turn = await h.begin(1);
      send = turn.pending;
    }
    const closing = first === 'stop' ? h.app.stop() : h.app.newConversation();
    await tick();
    const previous = h.app.getSnapshot();
    const replacing = h.app.newConversation();
    const cleared = h.app.getSnapshot();
    expect.soft(cleared.contextKey).not.toBe(previous.contextKey);
    expect.soft(cleared.rows).toHaveLength(0);
    expect.soft(cleared.current.status).toBe('unknown');
    expect.soft(cleared.checkpointPage).toBeUndefined();
    expect.soft(cleared.selection).toBeUndefined();
    expect.soft(cleared.inspection.status).toBe('idle');
    expect.soft(cleared.canSubmit).toBe(false);
    await h.app.submit('too early');
    expect(h.session.submit).toHaveBeenCalledTimes(first === 'stop' ? 2 : 1);
    held.resolve();
    h.run.resolve('aborted');
    await send;
    await closing;
    await replacing;
    expect(h.app.getSnapshot().canSubmit).toBe(true);
    expect(h.app.getSnapshot().rows).toHaveLength(0);
    expect(h.session.dispose).toHaveBeenCalledTimes(1);
    expect(h.session.stop).toHaveBeenCalledTimes(first === 'stop' ? 1 : 0);
  }
);
it('New during existing cleanup retains sticky quarantine after the latest intent', async () => {
  const h = setup();
  await h.confirmed();
  const held = deferred<void>();
  h.session.dispose.mockReturnValueOnce(held.promise);
  const closing = h.app.newConversation();
  const before = h.app.getSnapshot();
  const latest = h.app.newConversation();
  expect.soft(h.app.getSnapshot().contextKey).not.toBe(before.contextKey);
  held.reject(Error('cleanup failed'));
  await closing;
  await latest;
  expect(h.app.getSnapshot().canSubmit).toBe(false);
  expect(h.app.getSnapshot().activity).toBe('cleanup-failed');
  expect(h.session.dispose).toHaveBeenCalledTimes(1);
});
it.each([
  'refresh-success',
  'inspect-success',
  'refresh-failure',
  'inspect-failure',
] as const)(
  'keeps last-confirmed execution label during independent %s feedback',
  async (mode) => {
    const h = setup();
    await h.confirmed();
    const saved = h.app.getSnapshot(),
      turn = await h.begin(1);
    h.client.readCurrent.mockRejectedValueOnce(Error('saved contradiction'));
    await h.finishLive(1);
    await turn.pending;
    const failed = h.app.getSnapshot(),
      page = failed.checkpointPage!;
    h.client.readCheckpoint.mockResolvedValue(copy(fixture.turns[0].rawExact));
    if (mode === 'refresh-failure')
      h.client.readHistory.mockRejectedValueOnce(Error('read failed'));
    if (mode === 'inspect-failure')
      h.client.readCheckpoint.mockRejectedValueOnce(Error('read failed'));
    if (mode.startsWith('refresh'))
      await h.app.refresh({
        contextKey: page.contextKey,
        pageGeneration: page.pageGeneration,
      });
    else
      await h.app.inspect({
        contextKey: page.contextKey,
        pageGeneration: page.pageGeneration,
        rowKey: page.rows[0].rowKey,
      });
    const after = h.app.getSnapshot();
    expect(after.error).toBe(failed.error);
    expect(after.error).toContain('Last confirmed');
    expect(after.rows).toBe(saved.rows);
    expect(after.current).toBe(saved.current);
    expect(after.canSubmit).toBe(false);
    expect(after.confirmed).toBe(false);
    if (mode.endsWith('failure'))
      expect(after.readError).toContain(
        mode.startsWith('refresh')
          ? 'History refresh failed'
          : 'Checkpoint inspection failed'
      );
    else expect(after.readError).toBeNull();
  }
);
