import type { AgentQueueEntry, AgentTransport, LangGraphSubmitOptions, StreamEvent } from './transport.types.js';
import type { Run, ThreadState } from '@langchain/langgraph-sdk';

/** One run a {@link MockAgentTransport} started, and the status its backend would report. */
export interface MockAgentRun {
  /** `mock-run-1`, `mock-run-2`, and so on. */
  readonly id: string;
  readonly threadId: string | null;
  /**
   * What `getRunStatus` answers for this run. The transport sets it when the
   * run ends; a spec may assign another value to script what the backend
   * reports.
   */
  status: Run['status'];
}

/**
 * Test transport for deterministic agent testing without a real LangGraph server.
 *
 * A spec drives each run by hand: `emit()` sends events into the open stream,
 * and `close()`, `fail()` or `emitError()` ends it. A session over this
 * transport projects those events exactly as it projects a server's. Batches
 * given to the constructor are handed back in order by `nextBatch()`.
 *
 * **Event shape.** A session reads the graph state from a `values` event's
 * `data`: `{ type: 'values', data: { messages: [...], ...state } }`. A run that
 * ends with such an event, holding the thread's messages, settles `success`; a
 * run that closes without one settles `interrupted`, as a dropped connection
 * does. A streamed token is `{ type: 'messages', messages: [chunk] }`.
 *
 * **Several runs.** Each `stream()` call is a run of its own, recorded in
 * `runs` and `streams`. `close()`, `fail()` and `emitError()` end the run that
 * is open, or the next one to open when none is. The transport is then ready
 * for another run: script the next turn the same way.
 *
 * **What a session has over it.** `createThread`, `getHistory` and
 * `getRunStatus` are implemented, so the session offers `load`, `checkStatus`
 * and `retry`. A run ended with `close()` reports `success`. `fail()` closes
 * the stream and reports `error`, which a session publishes as a failure that
 * `retry()` sends again. `emitError()` throws from the stream, as a broken
 * connection does, and the run reports `error` to a later `checkStatus()`.
 * `getState` is not implemented, so the session has no `regenerate`.
 *
 * `emit()`, `emitError()`, `fail()`, `close()` and `flush()` are awaitable: the
 * returned promise settles once the session has consumed everything queued so
 * far (and one macrotask later, so throttled listeners have been called).
 *
 * @example
 * ```typescript
 * const transport = new MockAgentTransport();
 * const session = createSession({ assistantId: 'agent', transport });
 * const turn = session.submit('Hello');
 * await transport.emit([
 *   {
 *     type: 'values',
 *     data: {
 *       messages: [
 *         { id: 'u1', type: 'human', content: 'Hello' },
 *         { id: 'a1', type: 'ai', content: 'Hi' },
 *       ],
 *     },
 *   },
 * ]);
 * await transport.close();
 * await turn; // 'success'
 * ```
 */
export class MockAgentTransport implements AgentTransport {
  history: ThreadState[] = [];
  /** Child-namespace checkpoints served by `getChildState`, keyed by checkpoint namespace. */
  childStates = new Map<string, ThreadState>();
  readonly childStateCalls: Array<{ threadId: string; checkpointNs: string }> = [];
  readonly historyCalls: string[] = [];
  readonly streams: Array<{ threadId: string | null; payload: unknown; options?: LangGraphSubmitOptions }> = [];
  /** Every run `stream()` started, oldest first, with the status `getRunStatus` reports. */
  readonly runs: MockAgentRun[] = [];
  /** The thread ids `createThread` handed out, oldest first. */
  readonly createdThreads: string[] = [];
  readonly createdQueuedRuns: AgentQueueEntry[] = [];
  readonly cancelledRuns: Array<{ threadId: string; runId: string }> = [];
  readonly joinedRuns: Array<{ threadId: string; runId: string }> = [];
  private script: StreamEvent[][];
  private scriptIndex = 0;
  private streaming = false;
  private eventQueue: StreamEvent[] = [];
  // Each resolver simply wakes the stream loop to re-check state.
  private resolvers: Array<() => void> = [];
  // Awaiters registered by emit()/emitError()/close()/flush(), settled once the
  // stream loop has drained everything queued at the time they were registered.
  private consumers: Array<() => void> = [];
  private closed = false;
  private pendingError: Error | null = null;
  /** Set by `fail()`: the run that closes next is reported as failed. */
  private failing = false;
  /** The run whose stream is open: the one that owns the queue. */
  private open: MockAgentRun | undefined;
  /** True while the stream loop is suspended with an empty queue. */
  private idle = false;
  /** True once a stream run has ended (or before any run has started). */
  private finished = true;

  /** @param script - Array of event batches. Each batch is emitted as a group. */
  constructor(script: StreamEvent[][] = []) {
    this.script = script;
  }

  /** Advance to the next scripted batch. Pass the returned events to `emit()`. */
  nextBatch(): StreamEvent[] {
    if (this.scriptIndex >= this.script.length) return [];
    return this.script[this.scriptIndex++];
  }

  /**
   * Manually emit events into the stream.
   *
   * Await the returned promise: it resolves once the adapter has pulled this
   * batch out of the stream (or the run has ended), so signals are settled and
   * assertions read live state rather than the value from before the emit.
   */
  emit(events: StreamEvent[]): Promise<void> {
    this.eventQueue.push(...events);
    this.wake();
    return this.consumed();
  }

  /** Inject an error into the stream. Resolves once the stream has thrown. */
  emitError(err: Error): Promise<void> {
    this.pendingError = err;
    this.wake();
    return this.consumed();
  }

  /**
   * Close the stream. Remaining queued events are drained before completion.
   * Resolves once the run has finished. The run reports `success`, and the
   * transport is ready for the next run.
   */
  close(): Promise<void> {
    this.closed = true;
    this.wake();
    return this.consumed();
  }

  /**
   * Ends the run as one the backend reports failed: the stream closes after
   * its queued events and `getRunStatus` answers `error`. A session settles
   * the turn `error` with `recovery: 'retry'`, and `session.retry()` then
   * starts the next run with the same input. Resolves once the run has
   * finished.
   */
  fail(): Promise<void> {
    this.failing = true;
    return this.close();
  }

  /**
   * Resolve once everything emitted so far has been consumed, without emitting
   * anything new. Useful after driving the agent by some other route (a
   * `submit()`, a `switchThread()`) that has to reach the transport first.
   */
  flush(): Promise<void> {
    return this.consumed();
  }

  /** Returns true if a stream is currently active. */
  isStreaming(): boolean {
    return this.streaming;
  }

  async *stream(
    _assistantId: string,
    _threadId: string | null,
    _payload: unknown,
    signal: AbortSignal,
    options?: LangGraphSubmitOptions,
  ): AsyncIterable<StreamEvent> {
    this.streams.push({ threadId: _threadId, payload: _payload, options });
    const run: MockAgentRun = {
      id: `mock-run-${this.runs.length + 1}`,
      threadId: _threadId,
      status: 'running',
    };
    this.runs.push(run);
    // As a backend does: the run is named before its first event.
    options?.onRunCreated?.({
      run_id: run.id,
      ...(_threadId !== null ? { thread_id: _threadId } : {}),
    });
    this.open = run;
    this.streaming = true;
    this.finished = false;
    // A run the session stopped, or stopped reading, was cut short.
    let ended: Run['status'] = 'interrupted';
    try {
      while (!this.closed && !signal.aborted) {
        // A newer run owns the queue now; this one was abandoned unread.
        if (this.open !== run) return;
        if (this.pendingError) {
          ended = 'error';
          throw this.pendingError;
        }
        if (this.eventQueue.length > 0) {
          const event = this.eventQueue.shift();
          if (event) yield event;
        } else {
          // The queue is drained: everything awaited so far has been consumed.
          this.settleConsumers();
          this.idle = true;
          // Wait until wake() rouses us or the session stops the run. Without
          // the abort listener a stopped run would stay suspended here and
          // take the next run's wake-up.
          await new Promise<void>((resolve) => {
            if (signal.aborted) { resolve(); return; }
            const roused = () => {
              signal.removeEventListener('abort', roused);
              resolve();
            };
            signal.addEventListener('abort', roused, { once: true });
            this.resolvers.push(roused);
          });
          this.idle = false;
        }
      }
      if (signal.aborted) return;
      // Drain remaining events after close()
      while (this.eventQueue.length > 0) {
        const event = this.eventQueue.shift();
        if (event) yield event;
      }
      ended = this.failing ? 'error' : 'success';
    } finally {
      // A spec may have scripted another status while the run was open.
      if (run.status === 'running') run.status = ended;
      if (this.open === run) {
        // The run is over, however it ended. What ended it, and anything it
        // left unread, belonged to it alone: the next `stream()` starts clean.
        this.open = undefined;
        this.closed = false;
        this.failing = false;
        this.pendingError = null;
        this.eventQueue = [];
        this.streaming = false;
        this.idle = false;
        this.finished = true;
        // The run is over: nothing queued will ever be consumed, so release
        // every awaiter rather than leaving a spec hanging.
        this.settleConsumers();
      }
    }
  }

  /**
   * Names a new thread, as a backend does, so a session created without a
   * `threadId` works. The ids (`mock-thread-1`, `mock-thread-2`, ...) are
   * recorded in `createdThreads`.
   */
  async createThread(signal?: AbortSignal): Promise<string> {
    void signal;
    const id = `mock-thread-${this.createdThreads.length + 1}`;
    this.createdThreads.push(id);
    return id;
  }

  async createQueuedRun(
    _assistantId: string,
    threadId: string,
    payload: unknown,
    signal: AbortSignal,
    options?: LangGraphSubmitOptions,
  ): Promise<AgentQueueEntry> {
    void signal;
    const entry: AgentQueueEntry = {
      id: `queued-run-${this.createdQueuedRuns.length + 1}`,
      threadId,
      values: payload,
      options: { ...options, multitaskStrategy: 'enqueue' },
      createdAt: new Date(),
    };
    this.createdQueuedRuns.push(entry);
    return entry;
  }

  async cancelRun(threadId: string, runId: string, signal: AbortSignal): Promise<void> {
    void signal;
    this.cancelledRuns.push({ threadId, runId });
  }

  /**
   * The status of one run this transport started, as `runs` holds it. With it
   * a session offers `retry`. An id the transport never issued rejects.
   */
  async getRunStatus(threadId: string, runId: string, signal: AbortSignal): Promise<Run['status']> {
    void threadId;
    void signal;
    const run = this.runs.find((candidate) => candidate.id === runId);
    if (!run) throw new Error(`MockAgentTransport started no run "${runId}".`);
    return run.status;
  }

  async getHistory(threadId: string, signal: AbortSignal): Promise<ThreadState[]> {
    void signal;
    this.historyCalls.push(threadId);
    return this.history;
  }

  async getChildState(threadId: string, checkpointNs: string, signal: AbortSignal): Promise<ThreadState | undefined> {
    void signal;
    this.childStateCalls.push({ threadId, checkpointNs });
    return this.childStates.get(checkpointNs);
  }

  async *joinStream(
    threadId: string,
    runId: string,
    lastEventId: string | undefined,
    signal: AbortSignal,
  ): AsyncIterable<StreamEvent> {
    void lastEventId;
    void signal;
    this.joinedRuns.push({ threadId, runId });
    yield { type: 'values', values: { queued: true } };
  }

  /** Rouse the suspended stream loop so it re-checks queue/error/closed state. */
  private wake(): void {
    // Every waiter re-checks its own state; one that already left is a no-op.
    for (const resolve of this.resolvers.splice(0)) resolve();
  }

  /**
   * A promise for "everything queued right now has been consumed". Resolved on
   * a macrotask so throttled signal writes inside the adapter have landed.
   */
  private consumed(): Promise<void> {
    const alreadySettled =
      this.finished ||
      (this.idle && this.eventQueue.length === 0 && this.pendingError === null && !this.closed);
    if (alreadySettled) return new Promise<void>((resolve) => setTimeout(resolve, 0));
    return new Promise<void>((resolve) => { this.consumers.push(resolve); });
  }

  private settleConsumers(): void {
    const pending = this.consumers;
    this.consumers = [];
    for (const resolve of pending) setTimeout(resolve, 0);
  }
}
