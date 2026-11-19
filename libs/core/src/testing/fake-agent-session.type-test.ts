import type { AgentSession, AgentSnapshot } from '../index.js';
import { type } from '../index.js';
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

// A state declaration types the fake's state, its controls and its submissions.
interface Board {
  todos: string[];
  draft?: string;
}
const stateful = createFakeAgentSession({
  stateType: type<Board>(),
  state: { todos: [] },
  onSubmit: (input) => {
    if (typeof input !== 'string') {
      const sent: Partial<Board> | undefined = input.state;
      void sent;
    }
  },
});
const statefulSession: AgentSession<
  Record<string, never>,
  Board
> = stateful.session as AgentSession<Record<string, never>, Board>;
const todos: readonly string[] | undefined =
  stateful.session.getSnapshot().state?.todos;
stateful.setState({ todos: ['a'], draft: 'b' });
stateful.setState(undefined);
stateful.set({ state: { todos: [] } });
// @ts-expect-error the declaration decides the state type, not the value set
stateful.setState({ count: 1 });
// @ts-expect-error a whole state needs its required fields
stateful.setState({ draft: 'b' });
// @ts-expect-error the initial state must match the declaration
createFakeAgentSession({ stateType: type<Board>(), state: { todos: 1 } });
// @ts-expect-error fake state is readonly
stateful.session.getSnapshot().state?.todos.push('b');
const explicit = createFakeAgentSession<Catalog, Board>();
const explicitDraft: string | undefined =
  explicit.session.getSnapshot().state?.draft;
const anySession: AgentSession = stateful.session;
void [statefulSession, todos, explicitDraft, anySession];
