import { createAgentRef } from '@threadplane/angular';
import { type, type ToolContract } from '@threadplane/core';
import type { LangGraphSession } from '@threadplane/langgraph';

/** A message as LangGraph keeps it in graph state: only what this demo reads. */
export interface WireMessage {
  readonly type: string;
  readonly id?: string;
}

/** State shape for the messages cockpit (LangGraph MessagesState). */
export interface MessagesState {
  readonly messages: readonly WireMessage[];
}

/** Declares the graph state's type to `createSession({ stateType })`. */
export const MESSAGES_STATE = type<MessagesState>();

/** The session behind the messages agent: no typed tools, `MessagesState`. */
export type MessagesSession = LangGraphSession<
  Record<string, ToolContract>,
  MessagesState
>;

/**
 * Typed DI handle for the messages agent.
 * Wire with `provideAgent(MESSAGES_AGENT, () => ...)` and inject with
 * `injectAgent(MESSAGES_AGENT)` to get `Agent<MessagesSession>`, whose
 * `state()` is typed as `MessagesState`.
 */
export const MESSAGES_AGENT = createAgentRef<MessagesSession>('messages');
