import { createAgentRef, type Agent } from '@threadplane/angular';
import type { ToolContract } from '@threadplane/core';
import type { LangGraphSession } from '@threadplane/langgraph';

/** One itinerary stop as the graph state holds it. */
export interface DemoStateStop {
  id: string;
  day: number;
  place: string;
  note?: string;
  lat?: number;
  lng?: number;
}

/**
 * State shape for the canonical chat demo agent, as `agent.state()` reports
 * it. Mirrors the Python graph's `State` TypedDict in
 * `examples/chat/python/src/graph.py`, without `messages`: the session
 * publishes those as `agent.messages()`.
 */
export interface DemoState {
  model?: string | null;
  reasoning_effort?: string | null;
  gen_ui_mode?: string | null;
  itinerary?: DemoStateStop[];
}

/** The LangGraph session behind the canonical demo agent. */
export type DemoSession = LangGraphSession<Record<string, ToolContract>, DemoState>;

/** The agent the demo shell and its routed modes share. */
export type DemoAgent = Agent<DemoSession>;

/**
 * Typed DI handle for the canonical demo agent.
 * Wire with `provideAgent(DEMO_AGENT_REF, { createSession: … })` and inject
 * with `injectAgent(DEMO_AGENT_REF)` to get `Agent<DemoSession>`.
 */
export const DEMO_AGENT_REF = createAgentRef<DemoSession>('demo');
