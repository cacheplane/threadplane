/**
 * Shared config for the adapters' `provideFakeAgent()` helpers
 * (`@threadplane/langgraph` and `@threadplane/ag-ui`). Drives an in-process
 * fake backend that streams a canned assistant reply.
 */
export interface FakeAgentConfig {
  /** Assistant reply, streamed token-by-token. */
  tokens?: string[];
  /** Optional reasoning chunks emitted before the text reply. */
  reasoningTokens?: string[];
  /** Milliseconds between successive token emissions. */
  delayMs?: number;
}
