import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import {
  captureCheckpointState,
  captureCheckpointEvent,
  confirmCheckpoint,
} from './checkpoint-authority';
import type { AgentTransport, StreamEvent } from './transport.types';
import { controlledTransport } from './testing/controlled-transport';
import { deferred } from './testing/deferred';
import {
  checkpointEvent,
  fixture as checkpointFixture,
  position,
  saved,
} from './testing/checkpoint-fixture';

const ai = (citations?: unknown, content = 'Answer') => ({
  type: 'ai',
  id: 'answer',
  content,
  ...(citations === undefined ? {} : { additional_kwargs: { citations } }),
});
const citation = (title = 'Source') => ({
  id: 'source',
  title,
  extra: { tags: ['original'] },
});
const frame = (citations?: unknown, content = 'Answer'): StreamEvent => ({
  type: 'values',
  data: { messages: [ai(citations, content)] },
});
const cleanups: (() => Promise<void>)[] = [];
function fixture() {
  const streams: ReturnType<typeof controlledTransport<StreamEvent>>[] = [];
  const starts = Array.from({ length: 4 }, () => deferred<void>());
  const acknowledgments: ReturnType<typeof deferred<void>>[] = [];
  const stream = vi.fn<AgentTransport['stream']>((_a, _t, _input, signal) => {
    const index = streams.length;
    const controlled = controlledTransport<StreamEvent>({
      signal,
      ignoreAbort: true,
    });
    streams.push(controlled);
    starts[index].resolve();
    const iterator: AsyncIterableIterator<StreamEvent> = {
      [Symbol.asyncIterator]() {
        return iterator;
      },
      next() {
        acknowledgments[index]?.resolve();
        return controlled.stream.next();
      },
      return() {
        acknowledgments[index]?.resolve();
        return controlled.stream.return();
      },
    };
    return iterator;
  });
  const getHistory = vi.fn<NonNullable<AgentTransport['getHistory']>>(
    async () => []
  );
  const session = createSession({
    assistantId: 'agent',
    threadId: 'thread',
    transport: { stream, getHistory },
  });
  cleanups.push(() => session.dispose());
  return {
    session,
    stream,
    streams,
    getHistory,
    started: (index = 0) => starts[index].promise,
    async emit(event: StreamEvent, index = 0) {
      acknowledgments[index] = deferred<void>();
      streams[index].release(event);
      await acknowledgments[index].promise;
    },
  };
}
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('session citation ownership', () => {
  it('captures terminal candidates, publishes metadata-only updates and clears canonical omissions without reopening delivery', async () => {
    const f = fixture();
    const run = f.session.submit('Go');
    await f.started();
    await f.emit(frame([citation()]));
    const first = f.session.getSnapshot().messages.at(-1)!;
    const raw = [citation('Corrected')];
    await f.emit(frame(raw));
    const corrected = f.session.getSnapshot().messages.at(-1)!;
    expect(corrected.content).toBe(first.content);
    expect(corrected.citations?.[0].title).toBe('Corrected');
    expect(corrected).not.toBe(first);
    raw[0].title = 'Mutated';
    raw[0].extra.tags.push('mutated');
    f.streams[0].finish();
    expect(await run).toBe('success');
    expect(f.session.getSnapshot().messages.at(-1)).toMatchObject({
      citations: [{ title: 'Corrected', extra: { tags: ['original'] } }],
      delivery: { phase: 'complete', outcome: 'success' },
    });
    const beforeLoad = f.session.getSnapshot();
    f.getHistory.mockResolvedValue([saved('clean', [ai()])]);
    await f.session.load!();
    expect(f.session.getSnapshot().messages[0].citations).toBeUndefined();
    expect(beforeLoad.messages.at(-1)?.citations?.[0].title).toBe('Corrected');
    expect(f.stream).toHaveBeenCalledOnce();
    expect(f.getHistory).toHaveBeenCalledOnce();
  });

  it('replaces repeated delta metadata, retains omitted interim data and commits canonical removal', async () => {
    const f = fixture();
    const run = f.session.submit('Go');
    await f.started();
    const delta = (citations?: unknown, content = ''): StreamEvent => ({
      type: 'messages',
      messageMetadata: {},
      messages: [{ ...ai(citations, content), type: 'AIMessageChunk' }],
    });
    await f.emit(delta([citation()], 'A'));
    const first = f.session.getSnapshot().messages.at(-1)!;
    await f.emit(delta([citation()]));
    expect(f.session.getSnapshot().messages.at(-1)).toBe(first);
    await f.emit(delta(undefined, 'B'));
    expect(f.session.getSnapshot().messages.at(-1)?.citations).toBe(
      first.citations
    );
    await f.emit(delta([citation('Next')]));
    expect(f.session.getSnapshot().messages.at(-1)?.citations).toHaveLength(1);
    await f.emit(frame(undefined, 'Final'));
    expect(f.session.getSnapshot().messages.at(-1)?.citations?.[0].title).toBe(
      'Next'
    );
    f.streams[0].finish();
    expect(await run).toBe('success');
    expect(f.session.getSnapshot().messages.at(-1)?.citations).toBeUndefined();
  });

  it('captures history metadata before later transport getters mutate its source and preserves equal reload identity', async () => {
    const f = fixture();
    const raw = [citation()];
    const checkpoint = saved('history', [], {
      values: {
        messages: [ai(raw)],
        get application() {
          raw[0].title = 'Mutated';
          raw[0].extra.tags.push('mutated');
          return true;
        },
      },
    });
    f.getHistory.mockResolvedValueOnce([checkpoint]);
    await f.session.load!();
    const before = f.session.getSnapshot();
    expect(before.messages[0].citations?.[0]).toMatchObject({
      title: 'Source',
      extra: { tags: ['original'] },
    });
    f.getHistory.mockResolvedValue([
      saved('history', [ai([citation()])], {
        values: { messages: [ai([citation()])], application: true },
      }),
    ]);
    await f.session.load!();
    expect(f.session.getSnapshot()).toBe(before);
    expect(Object.isFrozen(raw[0])).toBe(false);
  });

  it.each(['history', 'stream'] as const)(
    'rejects stale citation ownership caused by a reentrant %s getter',
    async (mode) => {
      const f = fixture();
      let nested: Promise<unknown> | undefined;
      let fired = false;
      const raw = [
        {
          get title() {
            if (!fired) {
              fired = true;
              nested = f.session.submit('Replacement');
            }
            return 'Stale secret';
          },
        },
      ];
      if (mode === 'history') {
        f.getHistory.mockResolvedValue([saved('stale', [ai(raw)])]);
        await f.session.load!();
        await f.started();
      } else {
        const run = f.session.submit('Original');
        await f.started();
        await f.emit(frame(raw));
        await run;
        await f.started(1);
      }
      expect(fired).toBe(true);
      expect(
        f.session
          .getSnapshot()
          .messages.some((message) =>
            message.citations?.some((item) => item.title === 'Stale secret')
          )
      ).toBe(false);
      await f.session.stop();
      await nested;
    }
  );

  it('retains stopped metadata and isolates stale attempts during explicit citation replacement', async () => {
    const f = fixture();
    const oldRun = f.session.submit('Old');
    await f.started();
    await f.emit(frame([citation('Old')]));
    await f.session.stop();
    expect(await oldRun).toBe('aborted');
    const stopped = f.session.getSnapshot();
    const nextRun = f.session.submit('New');
    await f.started(1);
    f.streams[0].release(frame([citation('Stale')]));
    await f.emit(frame([citation('New')]), 1);
    f.streams[1].finish();
    expect(await nextRun).toBe('success');
    expect(
      f.session
        .getSnapshot()
        .messages.find((message) => message.id === 'answer')?.citations?.[0]
        .title
    ).toBe('New');
    expect(stopped.messages.at(-1)?.citations?.[0].title).toBe('Old');
    expect(stopped.messages.at(-1)?.delivery).toMatchObject({
      phase: 'complete',
      outcome: 'aborted',
    });
  });

  it('isolates equal message IDs in child projections and never executes child citations or tool metadata', async () => {
    const f = fixture();
    const run = f.session.submit('Go');
    await f.started();
    await f.emit(frame([citation('Root')]));
    await f.emit({ ...frame([citation('Child')]), namespace: ['child'] });
    await f.emit({ ...frame([citation('Sibling')]), namespace: ['sibling'] });
    const retained = f.session.getSnapshot();
    expect(retained.messages.at(-1)?.citations?.[0].title).toBe('Root');
    expect(
      retained.subgraphs.map((child) => child.messages[0].citations?.[0].title)
    ).toEqual(['Child', 'Sibling']);
    await f.emit({ ...frame([], 'Changed'), namespace: ['child'] });
    expect(f.session.getSnapshot().subgraphs[1]).toBe(retained.subgraphs[1]);
    expect(retained.subgraphs[0].messages[0].citations?.[0].title).toBe(
      'Child'
    );
    f.streams[0].finish();
    await run;
    expect(f.stream).toHaveBeenCalledOnce();
    expect(f.getHistory).not.toHaveBeenCalled();
  });

  it.each(
    (['history', 'stream'] as const).flatMap((mode) => [
      {
        mode,
        kind: 'throwing getter',
        extra: () => ({
          get secret() {
            throw new Error('PRIVATE_PROVIDER_DATA');
          },
        }),
      },
      { mode, kind: 'SDK instance', extra: () => ({ instance: new Date() }) },
      {
        mode,
        kind: 'callback',
        extra: () => ({ callback: () => 'PRIVATE_PROVIDER_DATA' }),
      },
      {
        mode,
        kind: 'cycle',
        extra: () => {
          const value: Record<string, unknown> = {};
          value['self'] = value;
          return value;
        },
      },
    ])
  )(
    'contains $kind citation extras on $mode without partial publication or raw error data',
    async ({ mode, extra }) => {
      const f = fixture();
      f.getHistory.mockResolvedValueOnce([
        saved('safe', [ai([citation('Safe')])]),
      ]);
      await f.session.load!();
      const raw = extra();
      if (mode === 'history') {
        const before = f.session.getSnapshot();
        f.getHistory.mockResolvedValueOnce([
          saved('bad', [ai([{ extra: raw }])]),
        ]);
        await expect(f.session.load!()).rejects.not.toThrow(
          'PRIVATE_PROVIDER_DATA'
        );
        expect(f.session.getSnapshot()).toBe(before);
      } else {
        const run = f.session.submit('Go');
        await f.started();
        await f.emit(frame([{ extra: raw }]));
        await run;
        expect(JSON.stringify(f.session.getSnapshot())).not.toContain(
          'PRIVATE_PROVIDER_DATA'
        );
        expect(
          f.session
            .getSnapshot()
            .messages.find((message) => message.id === 'answer')?.citations?.[0]
            .title
        ).toBe('Safe');
      }
    }
  );
});

describe('citation checkpoint and reconnect evidence', () => {
  it('rejects a Date-bearing exact checkpoint before normalization without admitting a fork or publishing metadata', async () => {
    const f = checkpointFixture();
    f.source.values = { messages: [ai([{ publishedAt: new Date() }])] };
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: f.transport,
    });
    cleanups.push(() => session.dispose());
    const before = session.getSnapshot();
    await expect(session.fork(position('a'), 'Rejected')).rejects.toThrow();
    expect(session.getSnapshot()).toBe(before);
    expect(f.transport.getState).toHaveBeenCalledOnce();
    expect(f.transport.stream).not.toHaveBeenCalled();
    expect(f.transport.getHistory).not.toHaveBeenCalled();
  });

  it('retains supported primitive metadata through strict checkpoint capture and preserves evidence comparison', () => {
    const state = saved('a', [
      ai([{ publishedAt: '2026-09-24' }, { publishedAt: 0 }]),
    ]);
    const captured = captureCheckpointState(state, position('a'));
    expect(captured.values).toEqual(state.values);
    const candidate = captureCheckpointEvent(checkpointEvent(state), 'thread');
    expect(confirmCheckpoint(candidate, state, 'run-a').state.values).toEqual(
      state.values
    );
    expect(() =>
      confirmCheckpoint(
        candidate,
        saved('a', [ai([{ publishedAt: 1 }])]),
        'run-a'
      )
    ).toThrow();
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    for (const unsupported of [{ publishedAt: new Date() }, { extra: cycle }]) {
      const bad = saved('a', [ai([unsupported])]);
      expect(() => captureCheckpointState(bad, position('a'))).toThrow(
        /plain data/
      );
      expect(() =>
        captureCheckpointEvent(checkpointEvent(bad), 'thread')
      ).toThrow(/plain data/);
      expect(Object.isFrozen(unsupported)).toBe(false);
    }
  });

  it('loads the exact branch with citations while historical tool evidence stays inert and request counts stay fixed', async () => {
    const f = checkpointFixture();
    const historical = [
      {
        ...ai([citation('Historical')]),
        tool_calls: [{ id: 'old', name: 'work', args: {} }],
      },
      { type: 'tool', id: 'result', tool_call_id: 'old', content: 'Saved' },
    ];
    f.source.values = { messages: historical };
    const handler = vi.fn(() => 'must not execute');
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: f.transport,
      tools: { work: { description: 'Work', handler } },
    });
    cleanups.push(() => session.dispose());
    expect(await session.fork(position('a'), 'Continue')).toBe('success');
    const branch = f.states.get('result-1')!;
    (branch.values as { messages: unknown[] }).messages[0] = {
      ...ai([citation('Reloaded')]),
      tool_calls: [{ id: 'old', name: 'work', args: {} }],
    };
    await session.load!();
    expect(session.getSnapshot().messages[0].citations?.[0].title).toBe(
      'Reloaded'
    );
    expect(f.transport.getState).toHaveBeenCalledTimes(3);
    expect(vi.mocked(f.transport.getState!).mock.calls[2][1]).toEqual(
      position('result-1')
    );
    expect(f.transport.getHistory).not.toHaveBeenCalled();
    expect(f.transport.stream).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();
  });

  it('lets an explicit reconnect canonical correction remove earlier citation metadata without a second run', async () => {
    const stream = vi.fn<AgentTransport['stream']>(async function* (
      _a,
      _t,
      _input,
      _signal,
      options
    ) {
      options?.onRunCreated?.({ run_id: 'run', thread_id: 'thread' });
      yield {
        type: 'messages',
        messageMetadata: {},
        sseId: '1',
        messages: [ai([citation()], 'Partial')],
      };
    });
    const joinStream = vi.fn<NonNullable<AgentTransport['joinStream']>>(
      async function* () {
        yield { ...frame(undefined, 'Final'), sseId: '2' };
      }
    );
    const getRunStatus = vi.fn<NonNullable<AgentTransport['getRunStatus']>>(
      async () => 'running'
    );
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: { stream, joinStream, getRunStatus },
    });
    cleanups.push(() => session.dispose());
    await session.submit('Go');
    const interrupted = session.getSnapshot();
    expect(interrupted.messages.at(-1)?.citations?.[0].title).toBe('Source');
    getRunStatus.mockResolvedValue('success');
    expect(await session.reconnect()).toBe('success');
    expect(session.getSnapshot().messages.at(-1)).toMatchObject({
      content: 'Final',
      delivery: { phase: 'complete', outcome: 'success' },
    });
    expect(session.getSnapshot().messages.at(-1)?.citations).toBeUndefined();
    expect(interrupted.messages.at(-1)?.citations?.[0].title).toBe('Source');
    expect(stream).toHaveBeenCalledOnce();
    expect(joinStream).toHaveBeenCalledOnce();
  });
});
