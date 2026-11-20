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

// Interrupts, child agents and resume use the core shapes.
const pausing = createFakeAgentSession({
  interrupts: [{ id: 'i1', value: { tool: 'send' } }],
  subagents: [
    { id: 'child', messages: [{ role: 'assistant', content: 'Hi' }] },
  ],
  onResume: (responses, fake) => {
    const first: string = responses[0].interruptId;
    fake.setInterrupts(undefined);
    void first;
    return 'success';
  },
});
pausing.setInterrupts([{ id: 'i2' }]);
// @ts-expect-error an interrupt needs an id
pausing.setInterrupts([{ value: 1 }]);
pausing.setSubagents([{ id: 'child', status: 'unknown' }]);
pausing.setSubagents([{ id: 'child', status: 'pending' }]);
// @ts-expect-error a child agent status is one of the five contract values
pausing.setSubagents([{ id: 'child', status: 'cancelled' }]);
// @ts-expect-error a resume handler returns an outcome
pausing.onResume(() => 'done');
const firstResume: string | undefined =
  pausing.resumes[0]?.responses[0]?.interruptId;
void firstResume;

// Optional members stay optional on the fake's session, and their records are typed.
import type { AgentCheckpoint, CompleteOutcome } from '../index.js';
import {
  runAgentSessionConformance,
  runInterruptConformance,
  type InterruptConformanceHarness,
} from './index.js';

const capable = createFakeAgentSession({
  commands: ['runWithoutMessage', 'regenerate', 'retry', 'checkStatus', 'clientTools'],
  stateType: type<Board>(),
  onRetry: (fake) => {
    const count: number = fake.retryCount;
    void count;
    return 'paused';
  },
});
const regenerated: Promise<CompleteOutcome> | undefined =
  capable.session.regenerate?.('m');
// @ts-expect-error optional commands may be absent
void capable.session.retry();
void capable.session.runWithoutMessage?.({ state: { draft: 'x' } });
// @ts-expect-error run state follows the declared state
void capable.session.runWithoutMessage?.({ state: { draft: 1 } });
const sentState: Partial<Board> | undefined = capable.runs[0]?.input?.state;
const resumedState: Partial<Board> | undefined =
  capable.resumes[0]?.options?.state;
// @ts-expect-error records are readonly
capable.regenerates.push({ messageId: 'm' });
// @ts-expect-error only known commands can be listed
createFakeAgentSession({ commands: ['fork'] });
const history: readonly AgentCheckpoint[] = [{ id: 'c', values: {} }];
capable.setCheckpoints(history, { m: 'c' });
// @ts-expect-error a checkpoint carries its values
capable.setCheckpoints([{ id: 'c' }]);
capable.emitCustomEvent('progress', { step: 1 });
// @ts-expect-error event data is plain data
capable.emitCustomEvent('progress', new Date());
void [regenerated, sentState, resumedState];

// Conformance suites take any session and any runner with describe and it.
declare const runner: {
  describe(name: string, body: () => void): void;
  it(name: string, body: () => void | Promise<void>): void;
};
runAgentSessionConformance('typed', () => typed, runner);
runAgentSessionConformance('stateful', () => statefulSession, runner);
// @ts-expect-error a runner is required: the suites import no test framework
runAgentSessionConformance('typed', () => typed);
declare const harness: InterruptConformanceHarness;
runInterruptConformance('typed', () => harness, runner, { restoration: true });
// @ts-expect-error a harness supplies the session and the backend controls
runInterruptConformance('typed', () => ({ session: typed }), runner);
