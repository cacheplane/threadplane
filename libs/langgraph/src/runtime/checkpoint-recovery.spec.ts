import { describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import type { StreamEvent } from './transport.types';
import { controlledTransport } from './testing/controlled-transport';
import {
  checkpointEvent,
  fixture,
  position,
  saved,
} from './testing/checkpoint-fixture';

describe('checkpoint retained authority', () => {
  it.each(['running', 'pending', 'interrupted', 'error', 'timeout'] as const)(
    'does not authorize an intermediate checkpoint under physical status %s',
    async (status) => {
      const f = fixture();
      f.transport.getRunStatus = vi.fn(async () => status);
      const handler = vi.fn(() => 'done');
      const intermediate = saved('intermediate', [
        {
          type: 'ai',
          id: 'tool',
          tool_calls: [{ id: 'work', name: 'work', args: {} }],
        },
      ]);
      f.states.set('intermediate', intermediate);
      f.transport.stream = vi.fn(async function* (_a, _t, _i, _s, options) {
        options?.onRunCreated?.({ run_id: 'run-intermediate' });
        yield checkpointEvent(intermediate);
      });
      const session = createSession({
        assistantId: 'agent',
        threadId: 'thread',
        transport: f.transport,
        tools: { work: { description: 'Work', handler, followUp: false } },
      });
      expect(await session.fork(position('a'), 'Run')).toBe('interrupted');
      expect(handler).not.toHaveBeenCalled();
      expect(f.transport.getState).toHaveBeenCalledTimes(1);
      await expect(session.load?.()).rejects.toThrow();
      await expect(session.checkStatus?.()).rejects.toThrow();
      expect(f.transport.getHistory).not.toHaveBeenCalled();
    }
  );
  it.each(['identity', 'cursor'] as const)(
    'keeps missing %s uncertain without advertising recovery',
    async (missing) => {
      const f = fixture();
      const stream = controlledTransport<StreamEvent>();
      f.transport.stream = vi.fn((_a, _t, _i, _s, options) => {
        if (missing !== 'identity')
          options?.onRunCreated?.({ run_id: 'run-b' });
        return stream.stream;
      });
      const session = createSession({
        assistantId: 'agent',
        threadId: 'thread',
        transport: f.transport,
      });
      const run = session.fork(position('a'), 'Run');
      await vi.waitFor(() => expect(f.transport.stream).toHaveBeenCalled());
      const event = checkpointEvent(saved('b'));
      stream.release(
        missing === 'cursor' ? { ...event, sseId: undefined } : event
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      await session.stop();
      expect(await run).toBe('aborted');
      expect(session.getSnapshot().reconnect).toBeUndefined();
      await expect(session.reconnect()).rejects.toThrow();
      await expect(session.submit('Wrong')).rejects.toThrow();
    }
  );
  it('retains a candidate across a root stream error for explicit same-run reconnect', async () => {
    const f = fixture();
    const result = saved('b');
    f.states.set('b', result);
    f.transport.stream = vi.fn(async function* (_a, _t, _i, _s, options) {
      options?.onRunCreated?.({ run_id: 'run-b' });
      yield checkpointEvent(result);
      yield { type: 'error' as const, data: { message: 'connection failed' } };
    });
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: f.transport,
    });
    expect(await session.fork(position('a'), 'Run')).toBe('error');
    expect(session.getSnapshot().reconnect?.runId).toBe('run-b');
    expect(await session.reconnect()).toBe('success');
    expect(f.transport.stream).toHaveBeenCalledTimes(1);
  });
});
