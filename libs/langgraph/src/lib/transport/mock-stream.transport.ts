import type { AgentQueueEntry, AgentTransport, LangGraphSubmitOptions, StreamEvent } from '../agent.types';
import type { ThreadState } from '@langchain/langgraph-sdk';

/**
 * Test transport for deterministic agent testing without a real LangGraph server.
 *
 * Script event batches upfront, then emit them manually or step through them
 * in your test specs. Supports error injection and close control.
 *
 * `emit()`, `emitError()`, `close()` and `flush()` are awaitable: the returned
 * promise settles once the adapter has consumed everything queued so far (and
 * one macrotask later, so throttled signal writes have landed), which removes
 * the hand-rolled `await new Promise(resolve => setTimeout(resolve, 0))` flush
 * from specs.
 *
 * @example
 * ```typescript
 * const transport = new MockAgentTransport([
 *   [{ type: 'values', messages: [aiMsg('Hello')] }],
 *   [{ type: 'values', messages: [aiMsg('Done')] }],
 * ]);
 * await transport.emit(transport.nextBatch());
 * ```
 */
export class MockAgentTransport implements AgentTransport {
  history: ThreadState[] = [];
  readonly historyCalls: string[] = [];
  readonly streams: Array<{ threadId: string | null; payload: unknown; options?: LangGraphSubmitOptions }> = [];
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
   * Resolves once the run has finished.
   */
  close(): Promise<void> {
    this.closed = true;
    this.wake();
    return this.consumed();
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
    this.streaming = true;
    this.finished = false;
    try {
      while (!this.closed && !signal.aborted) {
        if (this.pendingError) throw this.pendingError;
        if (this.eventQueue.length > 0) {
          const event = this.eventQueue.shift();
          if (event) yield event;
        } else {
          // The queue is drained: everything awaited so far has been consumed.
          this.settleConsumers();
          this.idle = true;
          // Wait until wake() rouses us, then loop again to check state.
          await new Promise<void>((resolve) => {
            if (signal.aborted) { resolve(); return; }
            this.resolvers.push(resolve);
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
    } finally {
      this.streaming = false;
      this.idle = false;
      this.finished = true;
      // The run is over: nothing queued will ever be consumed, so release
      // every awaiter rather than leaving a spec hanging.
      this.settleConsumers();
    }
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

  async getHistory(threadId: string, signal: AbortSignal): Promise<ThreadState[]> {
    void signal;
    this.historyCalls.push(threadId);
    return this.history;
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
    const resolve = this.resolvers.shift();
    if (resolve) resolve();
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
