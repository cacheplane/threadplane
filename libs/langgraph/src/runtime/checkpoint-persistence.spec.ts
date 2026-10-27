import { describe, expect, it, vi } from 'vitest';
import type { ToolExecutionStore } from '@threadplane/core/tools';
import { createSession } from './create-session';
import type {
  AgentTransport,
  OwnedCheckpointPosition,
} from './transport.types';
import { deferred } from './testing/deferred';
import {
  checkpointEvent,
  fixture,
  position,
  saved,
} from './testing/checkpoint-fixture';

const drain = () => new Promise<void>((resolve) => setImmediate(resolve));
function persistenceFixture() {
  const f = fixture();
  const recording = [deferred<void>(), deferred<void>()];
  const writes = [
    deferred<OwnedCheckpointPosition | void>(),
    deferred<OwnedCheckpointPosition | void>(),
  ];
  const result = saved('tools', [
    {
      type: 'ai',
      id: 'tools',
      content: '',
      tool_calls: ['first', 'second'].map((id) => ({
        id,
        name: 'work',
        args: { id },
      })),
    },
  ]);
  f.states.set('tools', result);
  f.transport.stream = vi.fn(async function* (_a, _t, _i, _s, options) {
    options?.onRunCreated?.({ run_id: 'run-tools' });
    yield checkpointEvent(result);
  });
  let writesStarted = 0;
  const update = vi.fn<NonNullable<AgentTransport['updateState']>>(
    () => writes[writesStarted++].promise
  );
  f.transport.updateState = update;
  const executionStore: ToolExecutionStore = {
    acquire: vi.fn<ToolExecutionStore['acquire']>(async () => ({
      status: 'acquired',
      token: 'owner',
    })),
    settle: vi.fn<ToolExecutionStore['settle']>(async ({ toolCallId }) => {
      await recording[toolCallId === 'first' ? 0 : 1].promise;
      return 'accepted';
    }),
  };
  const handler = vi.fn(({ id }: { id: string }) => `Result ${id}`);
  const session = createSession({
    assistantId: 'agent',
    threadId: 'thread',
    transport: f.transport,
    executionStore,
    tools: { work: { description: 'Work', handler, followUp: false } },
  });
  return { ...f, session, executionStore, handler, recording, writes, update };
}

describe('checkpoint persistence', () => {
  it.each(['stop', 'dispose'] as const)(
    'chains two late writes through one captured owner after %s without publication',
    async (command) => {
      const f = persistenceFixture();
      const run = f.session.fork(position('a'), 'Tools');
      await vi.waitFor(() =>
        expect(f.executionStore.settle).toHaveBeenCalledTimes(2)
      );
      await f.session[command]();
      expect(await run).toBe('aborted');
      const snapshot = f.session.getSnapshot();
      const notify = vi.fn();
      f.session.subscribe(notify);
      f.recording[0].resolve();
      await vi.waitFor(() => expect(f.update).toHaveBeenCalledTimes(1));
      expect(f.update.mock.calls[0][3]).toEqual({
        checkpoint: position('tools'),
      });
      f.recording[1].resolve();
      await drain();
      expect(f.update).toHaveBeenCalledTimes(1);
      if (command === 'stop')
        await expect(
          f.session.fork(position('a'), 'Overtake')
        ).rejects.toThrow();
      f.writes[0].resolve(position('write-one'));
      await vi.waitFor(() => expect(f.update).toHaveBeenCalledTimes(2));
      expect(f.update.mock.calls[1][3]).toEqual({
        checkpoint: position('write-one'),
      });
      expect(f.update.mock.calls[1][1]).toMatchObject({
        messages: [{ tool_call_id: 'second' }],
      });
      f.writes[1].resolve(position('write-two'));
      await drain();
      expect(f.session.getSnapshot()).toBe(snapshot);
      expect(notify).not.toHaveBeenCalled();
      expect(f.transport.stream).toHaveBeenCalledTimes(1);
      if (command === 'stop') {
        await f.session.submit('Next');
        expect(
          vi.mocked(f.transport.stream).mock.calls[1][4]?.checkpoint
        ).toEqual(position('write-two'));
      }
      await f.session.dispose();
    }
  );
  it.each(['lost', 'void', 'wrong-thread'] as const)(
    'keeps a %s acknowledgment uncertain through late arrivals and all commands',
    async (failure) => {
      const f = persistenceFixture();
      const run = f.session.fork(position('a'), 'Tools');
      await vi.waitFor(() =>
        expect(f.executionStore.settle).toHaveBeenCalledTimes(2)
      );
      await f.session.stop();
      expect(await run).toBe('aborted');
      f.recording[0].resolve();
      await vi.waitFor(() => expect(f.update).toHaveBeenCalledTimes(1));
      if (failure === 'lost')
        f.writes[0].reject(new Error('Committed but acknowledgment lost'));
      else
        f.writes[0].resolve(
          failure === 'void'
            ? undefined
            : { ...position('written'), thread_id: 'other' }
        );
      await drain();
      f.recording[1].resolve();
      await drain();
      await f.session.stop();
      for (const command of [
        () => f.session.submit('Next'),
        () => f.session.fork(position('a'), 'Fork'),
        () => f.session.resume(null),
        () => f.session.load?.(),
        () => f.session.checkStatus?.(),
        () => f.session.reconnect(),
      ])
        await expect(command()).rejects.toThrow();
      expect(f.update).toHaveBeenCalledTimes(1);
      expect(f.transport.stream).toHaveBeenCalledTimes(1);
      expect(f.transport.getHistory).not.toHaveBeenCalled();
      await f.session.dispose();
    }
  );
});
