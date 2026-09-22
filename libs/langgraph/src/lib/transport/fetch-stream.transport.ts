import type { Client, Run, StreamMode, ThreadState } from '@langchain/langgraph-sdk';
import type { AgentQueueEntry, AgentTransport, LangGraphClientOptions, LangGraphSubmitOptions, StreamEvent } from '../../runtime/transport.types';
import {
  createLangGraphClient,
  ɵcreateProtectedLangGraphClient,
} from '../client/create-langgraph-client';
import {
  createLangGraphRuntimeFetch,
  projectLangGraphOperationFailure,
  type RuntimeOperationFailureReporter,
} from '../../runtime/operation-errors';

/**
 * Production transport that connects to a LangGraph Platform API via HTTP and SSE.
 *
 * Creates threads automatically if no threadId is provided, and streams events
 * using the LangGraph SDK client.
 *
 * @example
 * ```typescript
 * const transport = new FetchStreamTransport(
 *   'http://localhost:2024',
 *   (id) => console.log('New thread:', id),
 * );
 * ```
 */
export class FetchStreamTransport implements AgentTransport {
  private client: Client;
  private onThreadId?: (id: string) => void;
  private readonly protectErrors: boolean;
  private readonly reportOperationFailure?: RuntimeOperationFailureReporter;
  /** @internal True only when this adapter installed its SDK error boundary. */
  readonly protectsOperationErrors: boolean;

  /**
   * @param apiUrl - Base URL of the LangGraph Platform API
   * @param onThreadId - Optional callback invoked when a new thread is created
   * @param clientOptions - Optional SDK client tuning (e.g. `maxRetries`)
   */
  constructor(
    apiUrl: string,
    onThreadId?: (id: string) => void,
    clientOptions?: LangGraphClientOptions,
    /** @internal Cockpit generation-bound failure reporting hook. */
    reportOperationFailure?: RuntimeOperationFailureReporter,
  ) {
    // createLangGraphClient handles the absolute-URL normalization
    // required by the SDK when `apiUrl` is a relative `/api`-style
    // path proxied by middleware in production.
    this.protectErrors = clientOptions?.defaultHeaders !== undefined || reportOperationFailure !== undefined;
    this.protectsOperationErrors = this.protectErrors;
    this.reportOperationFailure = reportOperationFailure;
    this.client = this.protectErrors
      ? ɵcreateProtectedLangGraphClient(
          apiUrl,
          clientOptions,
          createLangGraphRuntimeFetch(reportOperationFailure),
        )
      : createLangGraphClient(apiUrl, clientOptions);
    this.onThreadId = onThreadId;
  }

  /** Open a streaming connection, creating a thread if needed. */
  async *stream(
    assistantId: string,
    threadId: string | null,
    payload: unknown,
    signal: AbortSignal,
    options?: LangGraphSubmitOptions,
  ): AsyncIterable<StreamEvent> {
    let thread = threadId;
    if (!thread) {
      try {
        const t = await this.client.threads.create();
        thread = t.thread_id;
      } catch (error) {
        this.rethrowOperationError(error, signal);
      }
      try {
        this.onThreadId?.(thread);
      } catch (error) {
        this.rethrowLocalError(error, signal);
      }
    }

    let runPayload: ReturnType<typeof buildRunPayload>;
    try {
      runPayload = buildRunPayload(payload, signal, options);
    } catch (error) {
      return this.rethrowLocalError(error, signal);
    }
    let run: ReturnType<Client['runs']['stream']>;
    try {
      run = this.client.runs.stream(
        thread,
        assistantId,
        runPayload,
      );
    } catch (error) {
      this.rethrowOperationError(error, signal);
    }
    yield* this.iterateSdkRun(run, signal);
  }

  /** Join an already-started run without creating a new thread. */
  async *joinStream(
    threadId: string,
    runId: string,
    lastEventId: string | undefined,
    signal: AbortSignal,
  ): AsyncIterable<StreamEvent> {
    // SDK joinStream: joins an already-started run without creating a new one.
    let run: ReturnType<Client['runs']['joinStream']>;
    try {
      run = this.client.runs.joinStream(threadId, runId, {
        signal,
        ...(lastEventId !== undefined ? { lastEventId } : {}),
      });
    } catch (error) {
      this.rethrowOperationError(error, signal);
    }
    yield* this.iterateSdkRun(run, signal);
  }

  /** @internal Exact-run inspection for the private owned reconnect command. */
  async getRunStatus(threadId: string, runId: string, signal: AbortSignal): Promise<Run['status']> {
    try {
      const run = await this.client.runs.get(threadId, runId, { signal });
      if (run.run_id !== runId || run.thread_id !== threadId ||
        !['pending', 'running', 'success', 'error', 'timeout', 'interrupted'].includes(run.status))
        throw new Error('Invalid LangGraph run status response.');
      return run.status;
    } catch (error) {
      return this.rethrowOperationError(error, signal);
    }
  }

  /** Create a pending server-side run using LangGraph's enqueue strategy. */
  async createQueuedRun(
    assistantId: string,
    threadId: string,
    payload: unknown,
    signal: AbortSignal,
    options?: LangGraphSubmitOptions,
  ): Promise<AgentQueueEntry> {
    let runPayload: ReturnType<typeof buildRunPayload> & { multitaskStrategy: 'enqueue' };
    try {
      runPayload = {
        ...buildRunPayload(payload, signal, options),
        multitaskStrategy: 'enqueue',
      };
    } catch (error) {
      return this.rethrowLocalError(error, signal);
    }
    let run: Awaited<ReturnType<Client['runs']['create']>>;
    try {
      run = await this.client.runs.create(threadId, assistantId, runPayload);
    } catch (error) {
      return this.rethrowOperationError(error, signal);
    }
    try {
      return {
        id: run.run_id,
        threadId: run.thread_id ?? threadId,
        values: payload,
        options: { multitaskStrategy: 'enqueue', signal },
        createdAt: run.created_at ? new Date(run.created_at) : new Date(),
      };
    } catch (error) {
      return this.rethrowLocalError(error, signal);
    }
  }

  /** Cancel a server-side run. */
  async cancelRun(threadId: string, runId: string, signal: AbortSignal): Promise<void> {
    try {
      await this.client.runs.cancel(threadId, runId, false, 'interrupt', { signal });
    } catch (error) {
      this.rethrowOperationError(error, signal);
    }
  }

  /** Load persisted checkpoint history for a thread. */
  async getHistory(threadId: string, signal: AbortSignal): Promise<ThreadState[]> {
    try {
      return await this.client.threads.getHistory(threadId, { signal });
    } catch (error) {
      return this.rethrowOperationError(error, signal);
    }
  }

  /** Update server-side thread state, e.g. to remove messages for regenerate rollback. */
  async updateState(
    threadId: string,
    values: Record<string, unknown>,
    _signal: AbortSignal,
    options?: { asNode?: string },
  ): Promise<void> {
    const body: { values: Record<string, unknown>; asNode?: string } = { values };
    if (options?.asNode !== undefined) {
      body.asNode = options.asNode;
    }
    try {
      await this.client.threads.updateState(threadId, body);
    } catch (error) {
      this.rethrowOperationError(error, _signal);
    }
  }

  private rethrowOperationError(error: unknown, signal: AbortSignal): never {
    if (!this.protectErrors) throw error;
    return projectLangGraphOperationFailure(error, signal, this.reportOperationFailure);
  }

  private rethrowLocalError(error: unknown, signal: AbortSignal): never {
    if (!this.protectErrors) throw error;
    return projectLangGraphOperationFailure(error, signal, undefined);
  }

  private async *iterateSdkRun(
    run: ReturnType<Client['runs']['stream']> | ReturnType<Client['runs']['joinStream']>,
    signal: AbortSignal,
  ): AsyncIterable<StreamEvent> {
    let iterator: AsyncIterator<{ event: string; data: unknown; id?: unknown }>;
    try {
      iterator = run[Symbol.asyncIterator]();
    } catch (error) {
      return this.rethrowOperationError(error, signal);
    }
    let completed = false;
    let failed = false;
    try {
      while (true) {
        let next: IteratorResult<{ event: string; data: unknown; id?: unknown }>;
        try {
          next = await iterator.next();
        } catch (error) {
          return this.rethrowOperationError(error, signal);
        }
        if (next.done) {
          completed = true;
          return;
        }
        try {
          yield { ...normalizeSdkEvent(next.value.event as StreamEvent['type'], next.value.data), sseId: typeof next.value.id === 'string' ? next.value.id : undefined };
        } catch (error) {
          return this.rethrowLocalError(error, signal);
        }
      }
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      if (!completed) {
        try {
          await iterator.return?.();
        } catch (error) {
          // Closing the SDK iterator must not replace an already projected failure.
          if (!failed) this.rethrowOperationError(error, signal);
        }
      }
    }
  }
}

function buildRunPayload(
  input: unknown,
  signal: AbortSignal,
  options?: LangGraphSubmitOptions,
): {
  input: Record<string, unknown> | null;
  streamMode: StreamMode[];
  streamSubgraphs: boolean;
  signal: AbortSignal;
} & Omit<LangGraphSubmitOptions, 'signal' | 'resume' | 'checkpoint' | 'streamMode' | 'streamSubgraphs'> {
  const runOptions = { ...(options ?? {}) };
  const hasCheckpoint = Object.prototype.hasOwnProperty.call(runOptions, 'checkpoint');
  const checkpoint = runOptions.checkpoint;
  const streamMode = runOptions.streamMode;
  const streamSubgraphs = runOptions.streamSubgraphs;
  delete runOptions.signal;
  delete runOptions.resume;
  delete runOptions.checkpoint;
  delete runOptions.streamMode;
  delete runOptions.streamSubgraphs;

  return {
    ...runOptions,
    ...(hasCheckpoint ? { checkpoint } : {}),
    input: input as Record<string, unknown> | null,
    streamMode: streamMode ?? defaultStreamMode(),
    streamSubgraphs: streamSubgraphs ?? true,
    signal,
  };
}

function defaultStreamMode(): StreamMode[] {
  // 'tools' is intentionally omitted: not supported by langgraph_api < 0.9.x
  // Servers reject the entire request with HTTP 422 if any stream_mode in
  // the array is unknown to them. Tool-call data is still derivable from
  // the messages stream.
  return ['values', 'messages-tuple', 'updates', 'custom'];
}

function normalizeSdkEvent(type: StreamEvent['type'], data: unknown): StreamEvent {
  const namespace = extractNamespace(type);
  const baseType = getBaseEventType(type);

  if (baseType === 'messages' && Array.isArray(data) && data.length === 2 && isRecord(data[1])) {
    return { type, ...(namespace ? { namespace } : {}), messages: [data[0]], messageMetadata: data[1], data };
  }

  if (isMessagesEvent(type) && Array.isArray(data)) {
    return { type, ...(namespace ? { namespace } : {}), messages: data, data };
  }

  if (isRecord(data)) {
    // Application fields remain in data; they cannot change protocol routing.
    return {
      ...data,
      type,
      ...(namespace || Object.hasOwn(data, 'namespace') ? { namespace } : {}),
      data,
    };
  }

  return { type, ...(namespace ? { namespace } : {}), data };
}

function isMessagesEvent(type: StreamEvent['type']): boolean {
  const baseType = getBaseEventType(type);
  return baseType === 'messages' || baseType.startsWith('messages/');
}

function getBaseEventType(type: StreamEvent['type']): string {
  return String(type).split('|')[0];
}

function extractNamespace(type: StreamEvent['type']): string[] | undefined {
  const parts = String(type).split('|');
  return parts.length > 1 ? parts.slice(1) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
