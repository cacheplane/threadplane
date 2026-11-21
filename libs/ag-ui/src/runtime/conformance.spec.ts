import type { AbstractAgent, BaseEvent, RunAgentInput } from '@ag-ui/client';
import type { AgentInterruptResponse, PlainValue } from '@threadplane/core';
import {
  interruptConformanceBatch,
  runAgentSessionConformance,
  runInterruptConformance,
  type InterruptConformanceHarness,
  type InterruptConformanceRequest,
} from '@threadplane/core/testing';
import { describe, it } from 'vitest';
import { createSession, type Session } from './create-session';
import { memoryStore } from './testing/memory-store';

const url = 'https://conformance.invalid/agent';
const sse = (events: readonly object[]) =>
  new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } }
  );
const input = (init?: { body?: unknown }) =>
  JSON.parse(String(init?.body)) as RunAgentInput;
const started = ({ threadId, runId }: RunAgentInput) => ({
  type: 'RUN_STARTED',
  threadId,
  runId,
});
const finished = ({ threadId, runId }: RunAgentInput, outcome?: object) => ({
  type: 'RUN_FINISHED',
  threadId,
  runId,
  ...(outcome && { outcome }),
});
/** A backend that finishes every run at once. */
const answering = (async (_url: unknown, init?: { body?: unknown }) => {
  const request = input(init);
  return sse([started(request), finished(request)]);
}) as typeof fetch;

// The base contract, for every way a session is built.
runAgentSessionConformance(
  'AG-UI session over HTTP',
  () => createSession({ url, threadId: 't', fetch: answering }),
  { describe, it }
);
runAgentSessionConformance(
  'AG-UI session with a client-tool catalog',
  () =>
    createSession(
      { url, threadId: 't', fetch: answering },
      { noop: { description: 'Does nothing.', handler: () => null } }
    ),
  { describe, it }
);
runAgentSessionConformance(
  'AG-UI session with persistence',
  async () => {
    const session = createSession({
      url,
      threadId: 't',
      fetch: answering,
      persistence: { namespace: 'conformance', store: memoryStore().store },
    });
    await session.ready;
    return session;
  },
  { describe, it }
);
runAgentSessionConformance(
  'AG-UI session over a client agent',
  () =>
    createSession({
      threadId: 't',
      agent: {
        run: (request: RunAgentInput) =>
          ({
            subscribe(observer: {
              next(event: BaseEvent): void;
              complete(): void;
            }) {
              observer.next(started(request) as BaseEvent);
              observer.next(finished(request) as BaseEvent);
              observer.complete();
              return { unsubscribe: () => undefined };
            },
          } as unknown as ReturnType<AbstractAgent['run']>),
      },
    }),
  { describe, it }
);

/** The pause the interrupt suite expects, as the protocol's own outcome. */
const pauseOutcome = () => ({
  type: 'interrupt',
  // The protocol's interrupt carries what the backend sends in `metadata`.
  interrupts: interruptConformanceBatch().map(({ id, value }) => ({
    id,
    reason: 'confirmation',
    metadata: value,
  })),
});

/**
 * Drives the interrupt suite through the real session over a scripted
 * endpoint. The pause is the protocol's `RUN_FINISHED` interrupt outcome; the
 * failure is the endpoint refusing a request with `RUN_ERROR` before any
 * `RUN_STARTED`; the restored pause is read from the endpoint's event history.
 */
function interruptHarness(): InterruptConformanceHarness {
  const requests: InterruptConformanceRequest[] = [];
  /** The user messages the conversation already held when a request was sent. */
  let known = new Set<string>();
  let pauseNext = false;
  let failNext = false;
  let cancellations = 0;
  /** Set while a run's delivery is held: how to release it, and the run. */
  let late: { release: () => void; run?: Promise<unknown> } | undefined;
  let lateArrived: () => void = () => undefined;
  /** What the endpoint would replay for the thread: the run that paused. */
  let history: object[] = [];
  const encoder = new TextEncoder();

  const send = (async (_url: unknown, init?: { body?: unknown }) => {
    const request = input(init);
    const resume = (request.resume ?? []) as readonly {
      interruptId: string;
      status: 'resolved' | 'cancelled';
      payload?: PlainValue;
    }[];
    if (resume.some((entry) => entry.status === 'cancelled')) cancellations++;
    const users = request.messages.filter((message) => message.role === 'user');
    requests.push({
      responses: resume.map(
        ({ interruptId, status, payload }) =>
          ({
            interruptId,
            status,
            ...(payload !== undefined && { value: payload }),
          } as AgentInterruptResponse)
      ),
      state: (request.state ?? {}) as Readonly<Record<string, PlainValue>>,
      messages: users
        .filter((message) => !known.has(message.id))
        .map((message) => String(message.content)),
    });
    if (failNext) {
      failNext = false;
      // Refused before any run started: nothing took the request.
      return sse([{ type: 'RUN_ERROR', message: 'Refused before the run' }]);
    }
    known = new Set(users.map((message) => message.id));
    if (late && !late.run) {
      const held = late;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            const emit = (event: object) => {
              try {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
                );
              } catch {
                /* The session left; a late event has nowhere to go. */
              }
            };
            emit(started(request));
            held.release = () => {
              emit({ type: 'STATE_SNAPSHOT', snapshot: { late: true } });
              emit({
                type: 'MESSAGES_SNAPSHOT',
                messages: [
                  { id: 'late', role: 'assistant', content: 'Late response' },
                ],
              });
              emit(
                finished(request, {
                  type: 'interrupt',
                  interrupts: [
                    { id: 'late-interrupt', reason: 'confirmation' },
                  ],
                })
              );
              try {
                controller.close();
              } catch {
                /* Already cancelled by the session. */
              }
            };
            lateArrived();
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } }
      );
    }
    if (pauseNext) {
      pauseNext = false;
      history = [started(request), finished(request, pauseOutcome())];
      return sse(history);
    }
    return sse([started(request), finished(request)]);
  }) as typeof fetch;

  let session: Session = createSession({ url, threadId: 't', fetch: send });
  const sessions = [session];
  return {
    get session() {
      return session;
    },
    responses: interruptConformanceBatch().map((entry) => ({
      interruptId: entry.id,
      status: 'resolved' as const,
      value: { approved: true },
    })),
    requests,
    pause: async () => {
      pauseNext = true;
      const outcome = await session.runWithoutMessage?.();
      if (outcome !== 'paused')
        throw new Error(`The fixture run settled ${outcome}, not paused.`);
    },
    failNextDispatch: () => {
      failNext = true;
    },
    backendCancellationCount: () => cancellations,
    startLateDelivery: async () => {
      const arrived = new Promise<void>((resolve) => {
        lateArrived = resolve;
      });
      const held: NonNullable<typeof late> = { release: () => undefined };
      late = held;
      const run = session.runWithoutMessage?.();
      await arrived;
      held.run = run;
    },
    deliverLateEvents: async () => {
      late?.release();
      await late?.run;
      // Let a live session apply what the stream just delivered.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    restore: async () => {
      // The endpoint's own record of a run that paused, read by a new session.
      const paused = createSession({ url, threadId: 't', fetch: send });
      sessions.push(paused);
      pauseNext = true;
      await paused.runWithoutMessage?.();
      const stored = history;
      await session.dispose();
      session = createSession({
        url,
        threadId: 't',
        fetch: send,
        replay: async () => stored as BaseEvent[],
      });
      sessions.push(session);
      await session.ready;
    },
    cleanup: async () => {
      await Promise.all(sessions.map((owned) => owned.dispose()));
    },
  };
}

runInterruptConformance(
  'AG-UI session',
  interruptHarness,
  { describe, it },
  { restoration: true }
);
