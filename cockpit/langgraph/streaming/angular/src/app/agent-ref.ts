import { createAgentRef } from '@threadplane/angular';
import type { LangGraphSession } from '@threadplane/langgraph';

/**
 * Typed DI handle for the streaming agent.
 * Wire with `provideAgent(STREAMING_AGENT, () => ...)` and inject with
 * `injectAgent(STREAMING_AGENT)` to get `Agent<LangGraphSession>`: the
 * session's snapshot fields as signals plus its commands.
 *
 * The streaming graph is a plain LangGraph `MessagesState`. Its messages are
 * `agent.messages()` and it has no other state to describe.
 */
export const STREAMING_AGENT = createAgentRef<LangGraphSession>('streaming');
