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
 * Backs `provideFakeAgent()`. Unlike `MockAgentTransport` (passive, driven
 * manually from specs), this transport emits its tokens automatically on
 * `stream()`, then completes — suitable for offline demos and integration tests.
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
    // Default 60ms matches @threadplane/ag-ui's FakeAgent so both adapters'
    // provideFakeAgent() stream at the same cadence for the same config.
    this.delayMs = config.delayMs ?? 60;
  }

  async *stream(
    _assistantId: string,
    _threadId: string | null,
    _payload: unknown,
    signal: AbortSignal,
    _options?: LangGraphSubmitOptions,
  ): AsyncIterable<StreamEvent> {
    const id = 'fake-ai-1';

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
