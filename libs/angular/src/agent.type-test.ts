import type { Signal } from '@angular/core';
import type {
  AgentError,
  AgentInterrupt,
  AgentInterruptResponse,
  AgentPlanStep,
  AgentSession,
  AgentSessionCustomEvent,
  AgentStatus,
  AgentSubagent,
  AgentSubmitInput,
  AgentSubmitOptions,
  AgentUsage,
  CompleteOutcome,
  DeepReadonly,
  Message,
  PlainValue,
  ToolCall,
  ToolContract,
} from '@threadplane/core';
import {
  createAgent,
  createAgentRef,
  injectAgent,
  injectFakeAgentSession,
  provideAgent,
  provideFakeAgent,
  type Agent,
  type AgentLifecycle,
  type AgentRef,
} from './public-api.js';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Type-only proof against the actual LangGraph session; no production dependency.
import type {
  createSession as createLangGraphSession,
  LangGraphSession,
} from '../../langgraph/src/runtime/create-session';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Type-only proof against the actual LangGraph snapshot extras.
import type {
  LangGraphHistoryEntry,
  LangGraphInterrupt,
  LangGraphSubgraph,
} from '../../langgraph/src/runtime/langgraph-snapshot';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Type-only proof against the actual AG-UI session; no production dependency.
import type {
  ClientToolSession,
  Session as AgUiSession,
} from '../../ag-ui/src/runtime/create-session';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Type-only proof against the actual AG-UI snapshot extras.
import type { SessionInterrupt } from '../../ag-ui/src/runtime/agent-session';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Type-only proof against the actual AG-UI client-tool snapshot.
import type { ClientToolSessionSnapshot } from '../../ag-ui/src/runtime/client-tools';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Type-only proof against the actual AG-UI observation.
import type { Observation } from '../../ag-ui/src/runtime/session-observation';

type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Expect<T extends true> = T;

interface Tools {
  weather: { args: { city: string }; result: { temperature: number } };
  count: { args: { values: readonly string[] }; result: number };
}
type ToolRecord = { weather: Tools['weather']; count: Tools['count'] };
interface Board {
  todos: string[];
  owner?: string;
}

/** The core contract: every snapshot field a signal, every command as written. */
export function coreAgent(agent: Agent) {
  type Status = Expect<Same<typeof agent.status, Signal<AgentStatus>>>;
  type Messages = Expect<
    Same<typeof agent.messages, Signal<readonly Message[]>>
  >;
  type Calls = Expect<
    Same<
      typeof agent.toolCalls,
      Signal<readonly ToolCall<Record<string, ToolContract>>[]>
    >
  >;
  // Optional snapshot fields are always signals, of the value or undefined.
  type Failure = Expect<
    Same<typeof agent.error, Signal<AgentError | undefined>>
  >;
  type Plan = Expect<
    Same<typeof agent.plan, Signal<readonly AgentPlanStep[] | undefined>>
  >;
  type Usage = Expect<
    Same<typeof agent.usage, Signal<AgentUsage | undefined>>
  >;
  type State = Expect<
    Same<typeof agent.state, Signal<PlainValue | undefined>>
  >;
  type Interrupts = Expect<
    Same<
      typeof agent.interrupts,
      Signal<readonly AgentInterrupt[] | undefined>
    >
  >;
  type Subagents = Expect<
    Same<typeof agent.subagents, Signal<readonly AgentSubagent[] | undefined>>
  >;
  type Submit = Expect<
    Same<
      typeof agent.submit,
      (
        input: AgentSubmitInput<unknown>,
        options?: AgentSubmitOptions
      ) => Promise<CompleteOutcome>
    >
  >;
  type Stop = Expect<Same<typeof agent.stop, () => Promise<void>>>;
  // Optional commands stay optional, so a view can ask whether one exists.
  type Regenerate = Expect<
    Same<
      typeof agent.regenerate,
      | ((
          messageId: string,
          options?: AgentSubmitOptions
        ) => Promise<CompleteOutcome>)
      | undefined
    >
  >;
  type Resume = Expect<
    Same<
      typeof agent.resume,
      | ((
          responses: readonly AgentInterruptResponse[],
          options?: AgentSubmitOptions
        ) => Promise<CompleteOutcome>)
      | undefined
    >
  >;
  type Retry = Expect<
    Same<typeof agent.retry, (() => Promise<CompleteOutcome>) | undefined>
  >;
  type Check = Expect<
    Same<typeof agent.checkStatus, (() => Promise<void>) | undefined>
  >;
  type Custom = Expect<
    Same<
      typeof agent.onCustomEvent,
      | ((listener: (event: AgentSessionCustomEvent) => void) => () => void)
      | undefined
    >
  >;
  // What the agent adds because it outlives a session.
  type Thread = Expect<Same<typeof agent.threadId, Signal<string | null>>>;
  type Loading = Expect<Same<typeof agent.isThreadLoading, Signal<boolean>>>;
  type Switch = Expect<
    Same<typeof agent.switchThread, (threadId: string | null) => void>
  >;
  type Events = Expect<
    Same<
      typeof agent.customEvents,
      Signal<readonly AgentSessionCustomEvent[]>
    >
  >;
  type Lifecycle = Expect<Same<typeof agent.lifecycle, AgentLifecycle>>;
  // @ts-expect-error The agent owns its sessions; it offers no dispose.
  void agent.dispose;
  // @ts-expect-error Observation is through signals, not getSnapshot.
  void agent.getSnapshot;
  // @ts-expect-error Observation is through signals, not subscribe.
  void agent.subscribe;
  // @ts-expect-error Field signals are read-only.
  agent.messages.set([]);
  // @ts-expect-error Members cannot be replaced.
  agent.status = undefined as never;
  // @ts-expect-error No legacy member names exist.
  void agent.isLoading;
  // @ts-expect-error No legacy member names exist.
  void agent.interrupt;
  return {} as [
    Status,
    Messages,
    Calls,
    Failure,
    Plan,
    Usage,
    State,
    Interrupts,
    Subagents,
    Submit,
    Stop,
    Regenerate,
    Resume,
    Retry,
    Check,
    Custom,
    Thread,
    Loading,
    Switch,
    Events,
    Lifecycle
  ];
}

/** A tool catalog and a declared state type flow through the core contract. */
export function typedCoreAgent(agent: Agent<AgentSession<Tools, Board>>) {
  type State = Expect<
    Same<typeof agent.state, Signal<DeepReadonly<Board> | undefined>>
  >;
  type Calls = Expect<
    Same<typeof agent.toolCalls, Signal<readonly ToolCall<Tools>[]>>
  >;
  for (const call of agent.toolCalls()) {
    if (call.name === 'weather') {
      const city: string = call.args.city;
      // @ts-expect-error Each tool keeps its own argument shape.
      void call.args.values;
      if (call.status === 'complete') {
        const temperature: number = call.result.temperature;
        void temperature;
      }
      void city;
    }
    // @ts-expect-error Tool names stay a literal union.
    const unknownName: 'missing' = call.name;
    void unknownName;
  }
  const owner: string | undefined = agent.state()?.owner;
  // @ts-expect-error State is read-only.
  agent.state()?.todos.push('x');
  void agent.submit({ message: 'Add', state: { todos: ['a'] } });
  // @ts-expect-error A submitted state patch is checked against the declaration.
  void agent.submit({ message: 'Add', state: { todos: [1] } });
  void owner;
  return {} as [State, Calls];
}

/** A LangGraph session: its snapshot extras and its own commands. */
export function langGraphAgent(
  agent: Agent<LangGraphSession<Tools, Board>>,
  inferred: Agent<ReturnType<typeof createLangGraphSession>>
) {
  type History = Expect<
    Same<
      typeof agent.history,
      Signal<readonly LangGraphHistoryEntry[] | undefined>
    >
  >;
  type Subgraphs = Expect<
    Same<typeof agent.subgraphs, Signal<readonly LangGraphSubgraph[]>>
  >;
  type Interrupts = Expect<
    Same<typeof agent.interrupts, Signal<readonly LangGraphInterrupt[]>>
  >;
  type Issues = Expect<
    Same<typeof agent.stateIssues, Signal<readonly string[] | undefined>>
  >;
  type State = Expect<
    Same<typeof agent.state, Signal<DeepReadonly<Board> | undefined>>
  >;
  type Calls = Expect<
    Same<typeof agent.toolCalls, Signal<readonly ToolCall<Tools>[]>>
  >;
  // Backend commands pass through with the backend's own signatures.
  type Submit = Expect<
    Same<typeof agent.submit, LangGraphSession<Tools, Board>['submit']>
  >;
  type Fork = Expect<
    Same<typeof agent.fork, LangGraphSession<Tools, Board>['fork']>
  >;
  type Resume = Expect<
    Same<typeof agent.resume, LangGraphSession<Tools, Board>['resume']>
  >;
  type Load = Expect<
    Same<typeof agent.load, LangGraphSession<Tools, Board>['load']>
  >;
  // Where a command and a snapshot field share a name, the command is exposed.
  type Reconnect = Expect<
    Same<typeof agent.reconnect, LangGraphSession<Tools, Board>['reconnect']>
  >;
  // The session's plain thread id and lifecycle source become the agent's signals.
  type Thread = Expect<Same<typeof agent.threadId, Signal<string | null>>>;
  type Lifecycle = Expect<Same<typeof agent.lifecycle, AgentLifecycle>>;
  // Always present on this backend, so not optional here.
  const release: () => void = agent.onCustomEvent(() => undefined);
  const untypedState: Signal<Readonly<Record<string, PlainValue>> | undefined> =
    inferred.state;
  // @ts-expect-error The AG-UI transcript is not a LangGraph field.
  void agent.transcript;
  // @ts-expect-error History is read-only.
  agent.history()?.push({} as LangGraphHistoryEntry);
  void [release, untypedState];
  return {} as [
    History,
    Subgraphs,
    Interrupts,
    Issues,
    State,
    Calls,
    Submit,
    Fork,
    Resume,
    Load,
    Reconnect,
    Thread,
    Lifecycle
  ];
}

/** An AG-UI session: the protocol evidence beside the core fields. */
export function agUiAgent(
  agent: Agent<AgUiSession<Board>>,
  withTools: Agent<ClientToolSession<ToolRecord, Board>>
) {
  type Transcript = Expect<
    Same<typeof agent.transcript, Signal<Observation['transcript']>>
  >;
  type Decision = Expect<
    Same<typeof agent.decision, Signal<Observation['decision']>>
  >;
  type Run = Expect<Same<typeof agent.run, Signal<Observation['run']>>>;
  type Interrupts = Expect<
    Same<
      typeof agent.interrupts,
      Signal<readonly SessionInterrupt[] | undefined>
    >
  >;
  type State = Expect<
    Same<typeof agent.state, Signal<DeepReadonly<Board> | undefined>>
  >;
  type Submit = Expect<
    Same<typeof agent.submit, AgUiSession<Board>['submit']>
  >;
  type Resume = Expect<
    Same<typeof agent.resume, AgUiSession<Board>['resume']>
  >;
  type Retry = Expect<Same<typeof agent.retry, AgUiSession<Board>['retry']>>;
  // The session's own declaration passes through as a plain member.
  type Declared = Expect<
    Same<typeof agent.stateType, AgUiSession<Board>['stateType']>
  >;
  // The client-tool owner's typed calls are a backend extra, and appear too.
  type Calls = Expect<
    Same<
      typeof withTools.clientTools,
      Signal<ClientToolSessionSnapshot<ToolRecord, Board>['clientTools']>
    >
  >;
  void [withTools];
  if (agent.regenerate) void agent.regenerate('message');
  // @ts-expect-error An optional command must be checked before it is called.
  void agent.regenerate('message');
  // @ts-expect-error LangGraph history is not an AG-UI field.
  void agent.history;
  // @ts-expect-error LangGraph fork is not an AG-UI command.
  void agent.fork;
  return {} as [
    Transcript,
    Decision,
    Run,
    Interrupts,
    State,
    Submit,
    Resume,
    Retry,
    Declared,
    Calls
  ];
}

/** Refs carry the session type from the provider to the injection site. */
export function typedRefs() {
  const TRIP = createAgentRef<LangGraphSession<Tools, Board>>('trip');
  type Ref = Expect<
    Same<typeof TRIP, AgentRef<LangGraphSession<Tools, Board>>>
  >;
  const byRef = injectAgent(TRIP);
  type ByRef = Expect<
    Same<typeof byRef, Agent<LangGraphSession<Tools, Board>>>
  >;
  const plain = injectAgent();
  type Plain = Expect<Same<typeof plain, Agent<AgentSession>>>;
  const named = injectAgent<AgUiSession<Board>>();
  type Named = Expect<Same<typeof named, Agent<AgUiSession<Board>>>>;
  const built = createAgent({
    createSession: () => ({}) as AgUiSession<Board>,
  });
  type Built = Expect<Same<typeof built, Agent<AgUiSession<Board>>>>;
  provideAgent(TRIP, {
    createSession: ({ threadId, onThreadId }) => {
      const id: string | null = threadId;
      const report: (threadId: string) => void = onThreadId;
      void [id, report];
      return {} as LangGraphSession<Tools, Board>;
    },
  });
  provideAgent(TRIP, () => ({
    createSession: () => ({}) as LangGraphSession<Tools, Board>,
  }));
  provideAgent({ createSession: () => ({}) as AgUiSession });
  // @ts-expect-error A ref accepts only a factory for its own session type.
  provideAgent(TRIP, { createSession: () => ({}) as AgUiSession<Board> });
  // @ts-expect-error A session factory is required.
  provideAgent({});
  // @ts-expect-error A session must be disposable to be owned.
  provideAgent({ createSession: () => ({ getSnapshot: () => ({}), subscribe: () => () => undefined }) });

  const FAKE = createAgentRef<AgentSession<Tools, Board>>('fake');
  provideFakeAgent(FAKE, { session: { state: { todos: [] } } });
  // @ts-expect-error The fake's initial state follows the ref's declaration.
  provideFakeAgent(FAKE, { session: { state: { todos: [1] } } });
  provideFakeAgent({ tokens: ['Hi'], delayMs: 0 });
  const fake = injectFakeAgentSession(FAKE);
  fake().setState({ todos: ['a'] });
  // @ts-expect-error The fake's controls are typed by the ref.
  fake().setState({ todos: [1] });
  void [byRef, plain, named, built];
  return {} as [Ref, ByRef, Plain, Named, Built];
}

/** A backend's agent can be handed to a view written for the core contract. */
export function widening(
  langGraph: Agent<LangGraphSession>,
  agUi: Agent<AgUiSession>
) {
  const read = (agent: Agent) => agent.messages().length;
  // @ts-expect-error A core agent is not a backend's: it lacks the extras.
  const narrowed: Agent<LangGraphSession> = {} as Agent;
  void narrowed;
  return [read(langGraph), read(agUi)];
}
