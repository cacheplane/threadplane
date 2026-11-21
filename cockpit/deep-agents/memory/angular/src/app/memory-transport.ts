import {
  FetchStreamTransport,
  type LangGraphSubmitOptions,
  type StreamEvent,
} from '@threadplane/langgraph';
import type { MemoryScope } from './memory-scope';
/** Admission precedes even thread creation. The inherited transport owns all SDK
 * operation boundaries and read/join/cancel behavior. Context extras are retained,
 * but the Memory graph intentionally accepts exactly memory_scope. */
export class MemoryTransport extends FetchStreamTransport {
  constructor(
    apiUrl: string,
    private readonly scope: Pick<MemoryScope, 'admit'>,
    onThreadId?: ConstructorParameters<typeof FetchStreamTransport>[1],
    clientOptions?: ConstructorParameters<typeof FetchStreamTransport>[2],
    reportOperationFailure?: ConstructorParameters<
      typeof FetchStreamTransport
    >[3]
  ) {
    super(
      apiUrl,
      onThreadId,
      { ...clientOptions, maxRetries: 0 },
      reportOperationFailure
    );
  }
  private scoped(options?: LangGraphSubmitOptions): LangGraphSubmitOptions {
    const context = this.scope.admit();
    if (!context)
      throw new Error(
        'Browser memory identity is unavailable. Reload before sending again.'
      );
    return {
      ...options,
      context: { ...(options?.context as Record<string, unknown>), ...context },
    };
  }
  /** A session creates its thread before its first run: refuse that too. */
  override async createThread(signal: AbortSignal): Promise<string> {
    this.scoped();
    return super.createThread(signal);
  }
  override async *stream(
    assistantId: string,
    threadId: string | null,
    payload: unknown,
    signal: AbortSignal,
    options?: LangGraphSubmitOptions
  ): AsyncIterable<StreamEvent> {
    const admitted = this.scoped(options);
    yield* super.stream(assistantId, threadId, payload, signal, admitted);
  }
  override createQueuedRun(
    assistantId: string,
    threadId: string,
    payload: unknown,
    signal: AbortSignal,
    options?: LangGraphSubmitOptions
  ) {
    return super.createQueuedRun(
      assistantId,
      threadId,
      payload,
      signal,
      this.scoped(options)
    );
  }
}
