import { createAgentRef } from '@threadplane/angular';
import type { ToolContract } from '@threadplane/core';
import type { LangGraphSession } from '@threadplane/langgraph';

/**
 * Parent graph state for the subgraphs example, as `agent.state()` reports it.
 *
 * `research_topic` and `research_brief` are the two keys the parent shares
 * with the compiled child graph — writing a topic is what routes execution
 * into the subgraph, and the brief is what comes back out. The child's own
 * state has no `messages` key, which is why nothing it produces reaches the
 * transcript. The parent's `messages` are `agent.messages()`, not state.
 */
export interface SubgraphsState {
  research_topic?: string;
  research_brief?: string;
}

/** The session behind the subgraphs agent, with its state typed. */
export type SubgraphsSession = LangGraphSession<
  Record<string, ToolContract>,
  SubgraphsState
>;

/**
 * Typed DI handle for the subgraphs agent.
 * Wire with `provideAgent(SUBGRAPHS_AGENT, () => ...)` and inject with
 * `injectAgent(SUBGRAPHS_AGENT)` to get `Agent<SubgraphsSession>`.
 */
export const SUBGRAPHS_AGENT = createAgentRef<SubgraphsSession>('subgraphs');
