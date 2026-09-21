import type { AgentSession, AgentSnapshot } from '@threadplane/core';
import { createSession } from '../create-session';
import type { AgentTransport, StreamEvent } from '../transport.types';
import { controlledTransport } from './controlled-transport';
import { deferred } from './deferred';

export interface BindingTools {
  weather: { args: { city: string }; result: { temperature: number } };
  count: { args: { values: readonly string[] }; result: number };
}

/** Test-only composition: both native bindings borrow this actual runtime.
 * The receiver-dependent facade also models class-authored public sessions. */
export function bindingFixture() {
  const streams: ReturnType<typeof controlledTransport<StreamEvent>>[] = [];
  const starts = Array.from({ length: 8 }, () => deferred<void>());
  const entered = deferred<void>();
  const toolResult = deferred<{ temperature: number }>();
  let handlerCalls = 0;
  let handlerSignal: AbortSignal | undefined;
  const stream: AgentTransport['stream'] = (_a, _t, _p, signal) => {
    const controlled = controlledTransport<StreamEvent>({ signal });
    streams.push(controlled);
    starts[streams.length - 1].resolve();
    return controlled.stream;
  };
  const runtime = createSession({
    assistantId: 'binding-agent',
    threadId: 'binding-thread',
    transport: { stream },
    tools: {
      weather: {
        description: 'Weather',
        handler: (args: { city: string }, context: { signal: AbortSignal }) => {
          if (args.city !== 'Paris') throw new Error('Unexpected test city');
          handlerCalls++;
          handlerSignal = context.signal;
          entered.resolve();
          return toolResult.promise;
        },
      },
      count: {
        description: 'Count',
        handler: (args: { values: readonly string[] }) => args.values.length,
      },
    },
  });

  class BorrowedSession implements AgentSession<BindingTools> {
    subscriptions = 0;
    releases = 0;
    submitCalls = 0;
    stopCalls = 0;
    disposeCalls = 0;
    getSnapshot() {
      // Accessing a field makes a detached getSnapshot fail even on first read.
      void this.subscriptions;
      return runtime.getSnapshot();
    }
    subscribe(notify: () => void) {
      this.subscriptions++;
      const release = runtime.subscribe(notify);
      let active = true;
      return () => {
        if (active) this.releases++;
        active = false;
        release();
      };
    }
    submit(input: string) {
      this.submitCalls++;
      return runtime.submit(input);
    }
    stop() {
      this.stopCalls++;
      return runtime.stop();
    }
    dispose() {
      this.disposeCalls++;
      return runtime.dispose();
    }
  }

  const session = new BorrowedSession();
  return {
    session,
    streams,
    started: (index = 0) => starts[index].promise,
    entered: entered.promise,
    toolResult,
    get handlerCalls() {
      return handlerCalls;
    },
    get handlerSignal() {
      return handlerSignal;
    },
    async cleanup() {
      toolResult.resolve({ temperature: 0 });
      await runtime.dispose();
      streams.forEach((controlled) => controlled.finish());
    },
  };
}

/** Registers before releasing a transport event, without timers or polling. */
export function changed(
  session: AgentSession<BindingTools>,
  predicate: (snapshot: AgentSnapshot<BindingTools>) => boolean
) {
  if (predicate(session.getSnapshot())) return Promise.resolve();
  const result = deferred<void>();
  const release = session.subscribe(() => {
    if (predicate(session.getSnapshot())) {
      release();
      result.resolve();
    }
  });
  return result.promise;
}

export const delta = (content: string, id = 'answer'): StreamEvent => ({
  type: 'messages',
  messages: [{ type: 'AIMessageChunk', id, content }],
  messageMetadata: {},
});

export const finalText = (content: string): StreamEvent => ({
  type: 'values',
  data: { messages: [{ type: 'ai', id: 'answer', content }] },
});

export const weatherCall: StreamEvent = {
  type: 'values',
  data: {
    messages: [
      {
        type: 'ai',
        id: 'tool-request',
        content: '',
        tool_calls: [
          { id: 'weather-call', name: 'weather', args: { city: 'Paris' } },
        ],
      },
    ],
  },
};
