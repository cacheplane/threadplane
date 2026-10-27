import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSession, type SessionOptions } from './create-session';
import type { ThreadState } from '@langchain/langgraph-sdk';
import {
  checkpointEvent,
  fixture,
  position,
  saved,
} from './testing/checkpoint-fixture';
import { deferred } from './testing/deferred';

afterEach(() => vi.unstubAllGlobals());
describe('checkpoint command admission', () => {
  it('rejects unsupported pre-branch load without retaining ownership, then loads an activated branch exactly', async () => {
    const f = fixture();
    delete f.transport.getHistory;
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: f.transport,
    });
    let outcome: 'pending' | 'resolved' | 'rejected' = 'pending';
    const read = session.load?.();
    void read?.then(
      () => {
        outcome = 'resolved';
      },
      () => {
        outcome = 'rejected';
      }
    );
    try {
      // Drain already-queued promise work; no backend request can settle this read.
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(outcome).toBe('rejected');
      expect(f.transport.getState).not.toHaveBeenCalled();
      expect(await session.fork(position('a'), 'Fork')).toBe('success');
      await session.load?.();
      expect(f.transport.getState).toHaveBeenLastCalledWith(
        'thread',
        position('result-1'),
        expect.any(AbortSignal)
      );
    } finally {
      await session.dispose();
      await read?.catch(() => undefined);
    }
  });
  it.each(['checkpoint', 'input', 'options', 'signal', 'state'] as const)(
    'prevents stale commits after a reentrant %s getter stops preparation',
    async (field) => {
      const f = fixture();
      const session = createSession({
        assistantId: 'agent',
        threadId: 'thread',
        transport: f.transport,
      });
      const stop = () => {
        void session.stop();
      };
      const checkpoint =
        field === 'checkpoint'
          ? {
              ...position('a'),
              get checkpoint_id() {
                stop();
                return 'a';
              },
            }
          : position('a');
      const input =
        field === 'input'
          ? {
              get message() {
                stop();
                return 'Fork';
              },
            }
          : 'Fork';
      const options =
        field === 'signal'
          ? {
              get signal() {
                stop();
                return new AbortController().signal;
              },
            }
          : field === 'options'
          ? {
              get context() {
                stop();
                return {};
              },
            }
          : undefined;
      if (field === 'state')
        f.states.set('a', {
          ...f.source,
          get values() {
            stop();
            return f.source.values;
          },
        });
      const snapshot = session.getSnapshot();
      expect(await session.fork(checkpoint, input, options)).toBe('aborted');
      expect(f.transport.stream).not.toHaveBeenCalled();
      expect(session.getSnapshot()).toBe(snapshot);
      expect(f.transport.getState).toHaveBeenCalledTimes(
        field === 'state' ? 1 : 0
      );
    }
  );
  it('lets an observer stop an atomically installed baseline before the creation POST', async () => {
    const f = fixture();
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: f.transport,
    });
    const observed: string[][] = [];
    session.subscribe(() => {
      observed.push(
        session.getSnapshot().messages.map((message) => message.content)
      );
      if (session.getSnapshot().status === 'running') void session.stop();
    });
    expect(await session.fork(position('a'), 'Fork')).toBe('aborted');
    expect(observed[0]).toEqual(['Source A', 'Answer A', 'Fork']);
    expect(f.transport.stream).not.toHaveBeenCalled();
    await session.checkStatus?.();
  });
  it('captures owned SDK retries once, rejects positive retries before any I/O, and ignores supplied transport client options', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    let retryReads = 0;
    let retries = 1;
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      apiUrl: 'https://runtime.example',
      clientOptions: {
        get maxRetries() {
          retryReads++;
          return retries;
        },
      },
    });
    retries = 0;
    await expect(session.fork(position('a'), 'Fork')).rejects.toThrow(
      'maxRetries'
    );
    expect(retryReads).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    const f = fixture();
    const supplied = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: f.transport,
      get clientOptions(): SessionOptions['clientOptions'] {
        throw new Error('Must be ignored');
      },
    });
    expect(await supplied.fork(position('a'), 'Fork')).toBe('success');
  });
  it('keeps source failures safe and leaves prior observations untouched', async () => {
    const f = fixture();
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: f.transport,
    });
    await session.load?.();
    const before = session.getSnapshot();
    f.states.set(
      'a',
      saved('a', [
        {
          type: 'ai',
          id: 'hidden',
          tool_calls: [{ id: 'pending', name: 'unregistered', args: {} }],
        },
      ])
    );
    await expect(session.fork(position('a'), 'Fork')).rejects.not.toThrow(
      'secret'
    );
    expect(session.getSnapshot()).toBe(before);
    expect(f.transport.stream).not.toHaveBeenCalled();
  });
  it('rejects fork during history reads and branch commands during exact load', async () => {
    const f = fixture();
    const history = deferred<ThreadState[]>();
    f.transport.getHistory = vi.fn(() => history.promise);
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: f.transport,
    });
    const reading = session.load?.();
    await expect(session.fork(position('a'), 'Fork')).rejects.toThrow();
    history.resolve([]);
    await reading;
    expect(await session.fork(position('a'), 'Fork')).toBe('success');
  });
  it('blocks baseline ID reuse even when the new turn reuses its historical assistant message ID', async () => {
    const f = fixture();
    const call = { id: 'old', name: 'work', args: {} };
    const historical = {
      type: 'ai',
      id: 'same-assistant',
      content: '',
      tool_calls: [call],
    };
    f.states.set(
      'a',
      saved('a', [
        historical,
        { type: 'tool', tool_call_id: 'old', content: 'old result' },
      ])
    );
    f.transport.stream = vi.fn(async function* (_a, _t, input, _s, options) {
      options?.onRunCreated?.({ run_id: 'run-collision' });
      yield checkpointEvent(
        saved('collision', [
          ...(input as { messages: unknown[] }).messages,
          historical,
        ])
      );
    });
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: f.transport,
    });
    expect(await session.fork(position('a'), 'New turn')).toBe('interrupted');
    expect(session.getSnapshot().error?.message).toContain('identity conflict');
    await expect(session.submit('Again')).rejects.toThrow();
  });
  it('rejects changed baseline assistant content with a repeated call even when the stream omits the user anchor', async () => {
    const f = fixture();
    const historical = {
      type: 'ai',
      id: 'same',
      content: 'Old',
      tool_calls: [{ id: 'old', name: 'work', args: {} }],
    };
    f.states.set(
      'a',
      saved('a', [
        historical,
        { type: 'tool', tool_call_id: 'old', content: 'done' },
      ])
    );
    f.transport.stream = vi.fn(async function* (_a, _t, _i, _s, options) {
      options?.onRunCreated?.({ run_id: 'run-b' });
      const result = saved('b', [{ ...historical, content: 'New' }]);
      f.states.set('b', result);
      yield checkpointEvent(result);
    });
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: f.transport,
    });
    expect(await session.fork(position('a'), 'Run')).toBe('interrupted');
    expect(session.getSnapshot().error?.message).toContain('identity conflict');
  });
});
