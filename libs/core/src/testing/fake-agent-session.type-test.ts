import type { AgentSession, AgentSnapshot } from '../index.js';
import { createFakeAgentSession } from './index.js';

interface Catalog {
  weather: { args: { city: string }; result: { temp: number } };
}

const untyped: AgentSession = createFakeAgentSession().session;
const typed: AgentSession<Catalog> = createFakeAgentSession<Catalog>().session;
const widened: AgentSession = typed;
const snapshot: AgentSnapshot<Catalog> = typed.getSnapshot();

createFakeAgentSession<Catalog>({
  toolCalls: [
    // @ts-expect-error authored arguments keep their declared shape
    { id: 'w', name: 'weather', args: { town: 'Oslo' }, status: 'pending' },
  ],
});

// @ts-expect-error snapshots are readonly
createFakeAgentSession().session.getSnapshot().messages.push();

void [untyped, widened, snapshot];
