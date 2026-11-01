import type { ContentBlock } from './content-block';

/** A user message, interrupt resume payload, or runtime state patch submitted to an agent. */
export interface AgentSubmitInput {
  /** New user message to append. May be combined with `resume` and/or `state` in the same submit call. */
  message?: string | ContentBlock[];
  /** Resume payload for an active interrupt. */
  resume?: unknown;
  /** State patch to merge before submitting (runtime-interpreted). */
  state?: Record<string, unknown>;
}

/** Options for cancelling an agent submission through an abort signal. */
export interface AgentSubmitOptions {
  signal?: AbortSignal;
}
