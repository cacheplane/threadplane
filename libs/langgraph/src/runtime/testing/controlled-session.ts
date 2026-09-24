import { vi } from 'vitest';
import { createSession } from '../create-session';
import type { AgentTransport, StreamEvent } from '../transport.types';
import { controlledTransport } from './controlled-transport';
import { deferred } from './deferred';

export function controlledSession() {
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
