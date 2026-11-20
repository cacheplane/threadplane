import type {
  AgentQueueEntry,
  AgentTransport,
  LangGraphSubmitOptions,
  StreamEvent,
} from './transport.types.js';
import type { ThreadState } from '@langchain/langgraph-sdk';

/** What the canned reply of a {@link FakeStreamTransport} streams. */
export interface FakeStreamTransportConfig {
  /** The assistant reply, streamed one entry at a time. */
  readonly tokens?: readonly string[];
  /** Reasoning text streamed before the reply. */
  readonly reasoningTokens?: readonly string[];
  /** Milliseconds between entries. Defaults to 60; 0 streams without timers. */
  readonly delayMs?: number;
}

const DEFAULT_TOKENS = ['Hello', ' from', ' the', ' fake', ' LangGraph', ' agent.'];

/**
 * In-process AgentTransport that auto-streams a canned assistant reply.
 *
 * Pass it to `createSession({ transport })` for an offline demo or an
 * integration test of the real LangGraph session. Unlike `MockAgentTransport`
 * (passive, driven by hand from a spec), it streams its tokens by itself on
 * every `stream()` call and ends the run with the thread's saved messages, so
 * each submit settles `success` and a thread keeps its earlier turns.
 *
 * It creates threads, and reports an empty history. It has no run status, so a
 * session over it has no `retry` or `regenerate`. It is not what
 * `provideFakeAgent()` from `@threadplane/angular/testing` uses: that provider
 * runs the in-memory session of `@threadplane/core/testing`, with no transport.
 *
 * NOT for production use.
 */
export class FakeStreamTransport implements AgentTransport {
  private readonly tokens: readonly string[];
  private readonly reasoningTokens: readonly string[];
  private readonly delayMs: number;

  constructor(config: FakeStreamTransportConfig = {}) {
    this.tokens = config.tokens ?? DEFAULT_TOKENS;
    this.reasoningTokens = config.reasoningTokens ?? [];
    // 60ms is also the default cadence of `provideFakeAgent()`, so a demo
    // streams alike whichever double it uses.
    this.delayMs = config.delayMs ?? 60;
  }

  private threads = 0;

  /**
   * Names a new thread, as a backend does, so a session created without a
   * `threadId` works: `fake-thread-1`, `fake-thread-2`, and so on.
   */
  async createThread(): Promise<string> {
    return `fake-thread-${++this.threads}`;
  }

  private replies = 0;
  /** What each thread holds, as the wire messages a backend would save. */
  private readonly saved = new Map<string, readonly unknown[]>();

  async *stream(
    _assistantId: string,
    threadId: string | null,
    payload: unknown,
    signal: AbortSignal,
    _options?: LangGraphSubmitOptions,
  ): AsyncIterable<StreamEvent> {
    // Each reply is a message of its own: `fake-ai-1`, `fake-ai-2`, ...
    const id = `fake-ai-${++this.replies}`;
    const thread = threadId ?? '';
    const input = (payload as { messages?: unknown } | null | undefined)?.messages;
    const history = [
      ...(this.saved.get(thread) ?? []),
      ...(Array.isArray(input) ? input : []),
    ];

    let reasoning = '';
    for (const chunk of this.reasoningTokens) {
      if (signal.aborted) return;
      reasoning += chunk;
      yield {
        type: 'messages',
        messages: [
          { id, type: 'ai', content: '', additional_kwargs: { reasoning_content: reasoning } },
        ],
      } as unknown as StreamEvent;
      if (this.delayMs > 0) await delay(this.delayMs);
    }

    let content = '';
    for (const tok of this.tokens) {
      if (signal.aborted) return;
      content += tok;
      yield {
        type: 'messages',
        messages: [{ id, type: 'ai', content }],
      } as unknown as StreamEvent;
      if (this.delayMs > 0) await delay(this.delayMs);
    }
    if (signal.aborted) return;
    // A run ends with the thread's saved state, as a backend's does. Without
    // it a session cannot tell a finished reply from a dropped connection.
    const messages = [
      ...history,
      {
        id,
        type: 'ai',
        content,
        ...(reasoning ? { additional_kwargs: { reasoning_content: reasoning } } : {}),
      },
    ];
    this.saved.set(thread, messages);
    yield { type: 'values', messages, data: { messages } } as unknown as StreamEvent;
  }

  async createQueuedRun(
    _assistantId: string,
    threadId: string,
    payload: unknown,
    _signal: AbortSignal,
    options?: LangGraphSubmitOptions,
  ): Promise<AgentQueueEntry> {
    return {
      id: 'fake-queued-run',
      threadId,
      values: payload,
      options: { ...options, multitaskStrategy: 'enqueue' },
      createdAt: new Date(),
    };
  }

  async cancelRun(_threadId: string, _runId: string, _signal: AbortSignal): Promise<void> {
    // No-op: the fake has no real runs to cancel.
    return;
  }

  async getHistory(_threadId: string, _signal: AbortSignal): Promise<ThreadState[]> {
    return [];
  }

  async *joinStream(): AsyncIterable<StreamEvent> {
    // No queued-run replay in the fake; yields nothing.
    yield* [];
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
