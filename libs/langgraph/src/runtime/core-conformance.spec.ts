import type { ThreadState } from '@langchain/langgraph-sdk';
import type {
  AgentCheckpoint,
  AgentInterruptResponse,
  PlainValue,
} from '@threadplane/core';
import {
  interruptConformanceBatch,
  runAgentSessionConformance,
  runAgentSessionHistoryConformance,
  runInterruptConformance,
  type InterruptConformanceHarness,
  type InterruptConformanceRequest,
} from '@threadplane/core/testing';
import { describe, it } from 'vitest';
import { createSession } from './create-session';
import type {
  AgentTransport,
  LangGraphSubmitOptions,
  StreamEvent,
} from './transport.types';
import {
  controlledTransport,
  type ControlledTransport,
} from './testing/controlled-transport';

const runner = { describe, it };
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const answer = (id: string, content: string): StreamEvent => ({
  type: 'values',
  data: { messages: [{ type: 'ai', id, content }] },
});

/** A transport that answers every run with one assistant message. */
function answering(): AgentTransport {
  return {
    async *stream() {
      yield answer('answer', 'Done');
    },
  };
}

runAgentSessionConformance(
  'LangGraph session',
  () =>
    createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: answering(),
    }),
  runner
);

runAgentSessionConformance(
  'LangGraph session with a declared client tool catalog',
  () => {
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: { ...answering(), updateState: async () => undefined },
    });
    session.clientTools?.setCatalog([
      { name: 'get_weather', description: 'Weather', parameters: {} },
    ]);
    return session;
  },
  runner
);

runAgentSessionConformance(
  'LangGraph session with a fixed tool handler map',
  () =>
    createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: answering(),
      tools: { work: { description: 'Work', handler: () => 'done' } },
    }),
  runner
);

/** The backend's page for a seeded history: LangGraph sends newest first. */
function page(checkpoints: readonly AgentCheckpoint[]): ThreadState[] {
  return [...checkpoints].reverse().map(
    (checkpoint, index, all) =>
      ({
        checkpoint: {
          thread_id: 'thread',
          checkpoint_id: checkpoint.id,
          checkpoint_ns: '',
          checkpoint_map: {},
        },
        parent_checkpoint: all[index + 1]
          ? {
              thread_id: 'thread',
              checkpoint_id: all[index + 1].id,
              checkpoint_ns: '',
              checkpoint_map: {},
            }
          : null,
        values: checkpoint.values,
        next: index === 0 ? [] : ['agent'],
        tasks: [],
        metadata: null,
        created_at: null,
      } as unknown as ThreadState)
  );
}

runAgentSessionHistoryConformance(
  'LangGraph session with history state',
  async (seed) => {
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      historyState: true,
      transport: {
        ...answering(),
        getHistory: async () => page(seed?.checkpoints ?? []),
      },
    });
    await session.load?.();
    return session;
  },
  runner
);

const wireBatch = () =>
  interruptConformanceBatch().map(({ id, value }) => ({ id, value }));

/** The paused checkpoint a reload restores the batch from. */
function pausedHistory(): ThreadState[] {
  return [
    {
      values: {
        messages: [
          { type: 'human', id: 'saved-user', content: 'Start' },
          { type: 'ai', id: 'saved-answer', content: 'Waiting' },
        ],
      },
      next: ['approval'],
      tasks: [
        {
          id: 'task',
          name: 'approval',
          error: null,
          checkpoint: null,
          state: null,
          interrupts: wireBatch(),
        },
      ],
      checkpoint: {
        thread_id: 'thread',
        checkpoint_id: 'paused',
        checkpoint_ns: '',
        checkpoint_map: {},
      },
      metadata: null,
      created_at: null,
      parent_checkpoint: null,
    } as unknown as ThreadState,
  ];
}

/**
 * Drives the real session over a fake of the LangGraph run API. A run pauses
 * on the fixture batch, a resume command finishes it, and a failed dispatch
 * is a run the backend accepts and then reports as failed: the one failure
 * this runtime allows to be sent again.
 */
function interruptHarness(): InterruptConformanceHarness {
  const requests: InterruptConformanceRequest[] = [];
  const statuses = new Map<string, 'success' | 'error' | 'interrupted'>();
  let runs = 0;
  let cancellations = 0;
  let failNext = false;
  let holdNext = false;
  let held: ControlledTransport<StreamEvent> | undefined;
  let cleaned = false;

  /** What one run-creation request meant, read from its wire form. */
  function meaning(
    payload: unknown,
    options: LangGraphSubmitOptions | undefined
  ): InterruptConformanceRequest {
    const command = record(options?.command);
    const update = record(command?.['update']) ?? {};
    const resume = command?.['resume'];
    const answered = record(resume);
    const responses: AgentInterruptResponse[] = answered
      ? Object.entries(answered).map(([interruptId, value]) => ({
          interruptId,
          status: 'resolved',
          value: value as PlainValue,
        }))
      : [];
    const { messages: sent, ...state } = update;
    const texts = [
      ...(Array.isArray(record(payload)?.['messages'])
        ? (record(payload)?.['messages'] as unknown[])
        : []),
      ...(Array.isArray(sent) ? sent : []),
    ].flatMap((message) => {
      const content = record(message)?.['content'];
      return typeof content === 'string' ? [content] : [];
    });
    return {
      responses,
      state: state as Readonly<Record<string, PlainValue>>,
      messages: texts,
    };
  }

  const transport: AgentTransport = {
    stream(_assistant, _thread, payload, signal, options) {
      const runId = `run-${++runs}`;
      const request = meaning(payload, options);
      requests.push(request);
      options?.onRunCreated?.({ run_id: runId, thread_id: 'thread' });
      if (failNext) {
        failNext = false;
        statuses.set(runId, 'error');
        return (async function* (): AsyncGenerator<StreamEvent> {
          /* The backend reports this run as failed; nothing streams. */
        })();
      }
      if (holdNext) {
        holdNext = false;
        statuses.set(runId, 'success');
        held = controlledTransport<StreamEvent>({ signal });
        return held.stream;
      }
      const resuming = request.responses.length > 0;
      statuses.set(runId, resuming ? 'success' : 'interrupted');
      return (async function* (): AsyncGenerator<StreamEvent> {
        if (resuming) {
          yield answer(`${runId}-answer`, 'Approved');
          return;
        }
        yield answer(`${runId}-answer`, 'Waiting');
        yield { type: 'updates', data: { __interrupt__: wireBatch() } };
      })();
    },
    // The session captures a run's identity only when it could also join it.
    async *joinStream() {
      /* Never joined: every run here ends with a conclusive status. */
    },
    async getRunStatus(_thread, runId) {
      return statuses.get(runId) ?? 'error';
    },
    async cancelRun() {
      cancellations += 1;
    },
    async getHistory() {
      return pausedHistory();
    },
  };
  const session = createSession({
    assistantId: 'agent',
    threadId: 'thread',
    transport,
  });

  return {
    session,
    responses: interruptConformanceBatch().map(({ id }) => ({
      interruptId: id,
      status: 'resolved',
      value: { approved: true },
    })),
    async pause() {
      await session.submit('Start');
    },
    failNextDispatch() {
      failNext = true;
    },
    requests,
    backendCancellationCount: () => cancellations,
    async startLateDelivery() {
      holdNext = true;
      void session.submit('Late').catch(() => undefined);
      while (!held) await tick();
    },
    async deliverLateEvents() {
      held?.release(answer('late-answer', 'Delivered late'));
      held?.finish();
      await tick();
      await tick();
    },
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      await session.dispose();
    },
    async restore() {
      await session.load?.();
    },
  };
}

runInterruptConformance('LangGraph session', interruptHarness, runner, {
  restoration: true,
});
