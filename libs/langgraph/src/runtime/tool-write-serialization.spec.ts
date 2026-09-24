import { describe, expect, it, vi } from 'vitest';
import type { ToolExecutionStore } from '@threadplane/core/tools';
import { createSession } from './create-session';
import { deferred } from './testing/deferred';
import type { AgentTransport, StreamEvent } from './transport.types';

const drain = () => new Promise<void>((resolve) => setImmediate(resolve));
const callIds = ['first', 'second', 'third'];
const final: StreamEvent = {
  type: 'values',
  data: { messages: [{ type: 'ai', id: 'answer', content: 'Done' }] },
};

function toolEvent(ids: readonly string[]): StreamEvent {
  return {
    type: 'values',
    data: {
      messages: [
        {
          type: 'ai',
          id: `assistant-${ids.join('-')}`,
          content: '',
          tool_calls: ids.map((id) => ({ id, name: 'work', args: { id } })),
        },
      ],
    },
  };
}

function result(id: string) {
  return {
    id: `client-tool-result-${id}`,
    type: 'tool',
    role: 'tool',
    tool_call_id: id,
    content: `Result ${id}`,
  };
}

function fixture(failedFirstWrite = false) {
  const recorded = callIds.map(() => deferred<void>());
  const allRecording = deferred<void>();
  const writing = Array.from({ length: 3 }, () => deferred<void>());
  const written = Array.from({ length: 3 }, () => deferred<void>());
  const handoffStarted = deferred<void>();
  const handoffFinished = deferred<void>();
  let activeWrites = 0;
  let maxActiveWrites = 0;
  let streamCount = 0;
  const stream = vi.fn<AgentTransport['stream']>(async function* () {
    streamCount++;
    if (streamCount === 1) yield toolEvent(callIds);
    else if (streamCount === 2 && failedFirstWrite) {
      handoffStarted.resolve();
      await handoffFinished.promise;
      yield final;
    } else if (streamCount === 3 && failedFirstWrite)
      yield toolEvent(['later']);
    else yield final;
  });
  const updateState = vi.fn<NonNullable<AgentTransport['updateState']>>(
    async () => {
      const index = updateState.mock.calls.length - 1;
      activeWrites++;
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
      writing[index]?.resolve();
      try {
        // In the failure case, an unexpected automatic retry can finish. This
        // lets the test distinguish a drained failed queue from a held retry.
        if (!failedFirstWrite || index === 0) await written[index]?.promise;
      } finally {
        activeWrites--;
      }
    }
  );
  const getHistory = vi.fn<NonNullable<AgentTransport['getHistory']>>(
    async () => []
  );
  const executionStore = {
    claim: vi.fn(async () => 'claimed' as const),
    record: vi.fn<ToolExecutionStore['record']>((key) => {
      if (executionStore.record.mock.calls.length === callIds.length)
        allRecording.resolve();
      const index = callIds.indexOf(key.toolCallId);
      return index < 0 ? Promise.resolve() : recorded[index].promise;
    }),
  };
  const handler = vi.fn((args: { id: string }) => `Result ${args.id}`);
  const session = createSession({
    assistantId: 'agent',
    threadId: 'thread',
    transport: { stream, updateState, getHistory },
    executionStore,
    tools: { work: { description: 'Work', followUp: false, handler } },
  });
  const published = vi.fn();
  const off = session.subscribe(published);
  return {
    session,
    stream,
    updateState,
    getHistory,
    executionStore,
    handler,
    published,
    recorded,
    allRecording,
    writing,
    written,
    handoffStarted,
    handoffFinished,
    maxActiveWrites: () => maxActiveWrites,
    activeWrites: () => activeWrites,
    async cleanup() {
      recorded.forEach((gate) => gate.resolve());
      written.forEach((gate) => gate.resolve());
      handoffFinished.resolve();
      off();
      await session.dispose();
      await drain();
    },
  };
}

describe('terminal tool write serialization', () => {
  it.each(['stop', 'dispose'] as const)(
    'serializes late record acknowledgements after %s without stale publication',
    async (command) => {
      const f = fixture();
      try {
        const run = f.session.submit('First');
        await f.allRecording.promise;
        expect(f.executionStore.record).toHaveBeenCalledTimes(3);
        expect(f.handler).toHaveBeenCalledTimes(3);
        await f.session[command]();
        await expect(run).resolves.toBe('aborted');
        const snapshot = f.session.getSnapshot();
        const publications = f.published.mock.calls.length;

        f.recorded[0].resolve();
        await f.writing[0].promise;
        expect(f.updateState.mock.calls[0][1]).toEqual({
          messages: [result('first')],
        });
        expect(f.updateState.mock.calls[0][2].aborted).toBe(false);
        f.recorded[1].resolve();
        await drain();
        expect(f.updateState).toHaveBeenCalledTimes(1);
        expect(f.maxActiveWrites()).toBe(1);
        if (command === 'stop') {
          await expect(
            f.session.submit('Cannot overtake queued cleanup')
          ).rejects.toThrow();
          await expect(f.session.resume()).rejects.toThrow();
          await expect(f.session.load?.()).rejects.toThrow();
          expect(f.getHistory).not.toHaveBeenCalled();
        }

        f.written[0].resolve();
        await f.writing[1].promise;
        expect(f.updateState.mock.calls[1][1]).toEqual({
          messages: [result('second')],
        });
        expect(f.updateState.mock.calls[1][2].aborted).toBe(false);
        f.written[1].resolve();
        await drain();
        f.recorded[2].resolve();
        await f.writing[2].promise;
        expect(f.updateState.mock.calls[2][1]).toEqual({
          messages: [result('third')],
        });
        f.written[2].resolve();
        await drain();
        expect(f.activeWrites()).toBe(0);
        expect(f.maxActiveWrites()).toBe(1);
        expect(f.session.getSnapshot()).toBe(snapshot);
        expect(f.published).toHaveBeenCalledTimes(publications);
        expect(f.stream).toHaveBeenCalledTimes(1);
        await expect(f.session.submit('After cleanup')).resolves.toBe(
          command === 'dispose' ? 'aborted' : 'success'
        );
        expect(f.stream).toHaveBeenCalledTimes(command === 'dispose' ? 1 : 2);
        if (command === 'stop') {
          expect(f.stream.mock.calls[1][2]).toMatchObject({
            messages: [{ type: 'human', content: 'After cleanup' }],
          });
          expect(
            (f.stream.mock.calls[1][2] as { messages: unknown[] }).messages
          ).toHaveLength(1);
        }
      } finally {
        await f.cleanup();
      }
    }
  );

  it('retains queued and later results after a failed write until successful explicit handoff', async () => {
    const f = fixture(true);
    try {
      const run = f.session.submit('First');
      await f.allRecording.promise;
      await f.session.stop();
      await expect(run).resolves.toBe('aborted');
      const snapshot = f.session.getSnapshot();
      const publications = f.published.mock.calls.length;
      f.recorded[0].resolve();
      await f.writing[0].promise;
      f.recorded[1].resolve();
      await drain();
      f.written[0].reject(new Error('Write failed without acknowledgement'));
      await drain();
      expect(f.activeWrites()).toBe(0);
      expect(f.updateState).toHaveBeenCalledTimes(1);

      // This settlement arrives after the failed queue has drained. It must
      // inherit the failure latch, not trigger another automatic write.
      f.recorded[2].resolve();
      await drain();
      expect(f.updateState).toHaveBeenCalledTimes(1);
      expect(f.stream).toHaveBeenCalledTimes(1);
      expect(f.session.getSnapshot()).toBe(snapshot);
      expect(f.published).toHaveBeenCalledTimes(publications);

      const recovering = f.session.submit('Explicit recovery');
      await f.handoffStarted.promise;
      expect(f.stream.mock.calls[1][2]).toMatchObject({
        messages: [
          ...callIds.map(result),
          { type: 'human', content: 'Explicit recovery' },
        ],
      });
      expect(
        (f.stream.mock.calls[1][2] as { messages: unknown[] }).messages
      ).toHaveLength(4);
      expect(f.updateState).toHaveBeenCalledTimes(1);
      f.handoffFinished.resolve();
      await expect(recovering).resolves.toBe('success');

      await expect(f.session.submit('New terminal result')).resolves.toBe(
        'success'
      );
      expect(f.updateState).toHaveBeenCalledTimes(2);
      expect(f.updateState.mock.calls[1][1]).toEqual({
        messages: [result('later')],
      });
      expect(f.executionStore.record).toHaveBeenCalledTimes(4);
      expect(f.maxActiveWrites()).toBe(1);
      expect(
        (f.stream.mock.calls[2][2] as { messages: unknown[] }).messages
      ).toHaveLength(1);
    } finally {
      await f.cleanup();
    }
  });
});
