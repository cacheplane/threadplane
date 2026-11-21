import { createAgentRef } from '@threadplane/angular';
import type { ToolContract } from '@threadplane/core';
import type { LangGraphSession } from '@threadplane/langgraph';

/**
 * State of the LangGraph client-tools graph as `agent.state()` reports it
 * (mirrors the Python TypedDict in
 * cockpit/langgraph/client-tools/python/src/graph.py).
 *
 * The graph's `messages` channel is not part of it: the transcript is
 * `agent.messages()`.
 * `client_tools` carries the browser-declared tool catalog that the session
 * sends with each run.
 * `todos` is the plan the graph writes when one response requests several
 * browser tools; the session also publishes it as `agent.plan()`.
 */
export interface ClientToolsState {
  client_tools?: { name: string; description?: string }[];
  todos?: { content: string; status: 'pending' | 'in_progress' | 'completed' }[];
}

/** The session behind the client-tools agent, with its state typed. */
export type ClientToolsSession = LangGraphSession<
  Record<string, ToolContract>,
  ClientToolsState
>;

/**
 * Typed DI ref for the client-tools LangGraph agent.
 * Pass to `provideAgent` in `app.config.ts` and `injectAgent` in components
 * to carry the session type through DI without repeating the generic.
 */
export const CLIENT_TOOLS_AGENT_REF =
  createAgentRef<ClientToolsSession>('client-tools');
