import type { Provider } from '@angular/core';
import { createAgentRef, type Agent } from '@threadplane/angular';
import type { AgentSession } from '@threadplane/core';
import { provideAgentValue } from './public-api.js';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Type-only proof against the actual LangGraph session; no production dependency.
import type { LangGraphSession } from '../../../langgraph/src/runtime/create-session';

interface Tools {
  weather: { args: { city: string }; result: { temperature: number } };
}
interface Board {
  todos: string[];
}

/** An existing agent is provided with or without a ref, and with no cast. */
export function agentValue(
  core: Agent,
  typed: Agent<AgentSession<Tools, Board>>,
  backend: Agent<LangGraphSession<Tools, Board>>
) {
  const CORE = createAgentRef<AgentSession>('core');
  const TYPED = createAgentRef<AgentSession<Tools, Board>>('typed');
  const TRIP = createAgentRef<LangGraphSession<Tools, Board>>('trip');

  const providers: Provider[][] = [
    provideAgentValue(core),
    provideAgentValue(CORE, core),
    provideAgentValue(TYPED, typed),
    provideAgentValue(TRIP, backend),
    // A core-shaped mock stands in under a backend's ref.
    provideAgentValue(TRIP, core),
    // A backend's agent names its session type for the ref-less form.
    provideAgentValue<LangGraphSession<Tools, Board>>(backend),
  ];

  // @ts-expect-error Something that is not an agent is refused.
  provideAgentValue({ messages: [] });
  // @ts-expect-error Under a ref too.
  provideAgentValue(CORE, { messages: [] });
  // @ts-expect-error A ref alone provides nothing.
  provideAgentValue(CORE);
  return providers;
}
