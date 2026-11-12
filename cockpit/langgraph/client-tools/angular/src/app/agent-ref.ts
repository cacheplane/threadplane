import { createAgentRef } from '@threadplane/chat';
import type { BaseMessage } from '@langchain/core/messages';

/**
 * State shape of the LangGraph client-tools graph (mirrors the Python TypedDict
 * in cockpit/langgraph/client-tools/python/src/graph.py).
 *
 * `messages` is the LangChain message channel (add_messages-annotated list).
 * `client_tools` carries the browser-declared tool catalog that the
 * `@threadplane/langgraph` adapter ships as `input.client_tools`.
 */
export interface ClientToolsState {
  messages: BaseMessage[];
  client_tools: unknown[];
}

/**
 * Typed DI ref for the client-tools LangGraph agent.
 * Pass to `provideAgent` in `app.config.ts` and `injectAgent` in components
 * to carry `ClientToolsState` through DI without repeating the generic.
 */
export const CLIENT_TOOLS_AGENT_REF = createAgentRef<ClientToolsState>('client-tools');
