// Compile-time checks on the agent the chat library takes. Run by
// `nx run chat:type-tests`; nothing here executes.
import type { Signal } from '@angular/core';
import type { AgentSession, ToolCall } from '@threadplane/core';
import type { Agent as InjectedAgent } from './angular-agent';
import type { Assignable, Equal, Expect } from '../../testing/type-assert';
import type { MockAgent } from '../testing/mock-agent';
import type {
  Agent,
  AgentCheckpoint,
  AgentInputBlock,
  AgentInterrupt,
  AgentStatus,
  AgentSubagent,
  Message,
  StreamingToolCall,
} from './index';

// What every component reads: the snapshot fields are signals, and an optional
// field is a signal of its value or undefined, never a missing signal.
export type _Status = Expect<Equal<Agent['status'], Signal<AgentStatus>>>;
export type _Messages = Expect<Equal<Agent['messages'], Signal<readonly Message[]>>>;
export type _ToolCalls = Expect<Equal<Agent['toolCalls'], Signal<readonly ToolCall[]>>>;
export type _Interrupts = Expect<Equal<Agent['interrupts'], Signal<readonly AgentInterrupt[] | undefined>>>;
export type _Subagents = Expect<Equal<Agent['subagents'], Signal<readonly AgentSubagent[] | undefined>>>;
export type _Checkpoints = Expect<Equal<Agent['checkpoints'], Signal<readonly AgentCheckpoint[] | undefined>>>;
export type _Blocked = Expect<Equal<Agent['inputBlocked'], Signal<AgentInputBlock | undefined>>>;
export type _Streaming = Expect<
  Equal<Agent['streamingToolCalls'], Signal<readonly StreamingToolCall[] | undefined>>
>;
export type _ThreadLoading = Expect<Equal<Agent['isThreadLoading'], Signal<boolean>>>;

// The optional commands may be absent: a view asks before offering a control.
export type _RetryOptional = Expect<Assignable<undefined, Agent['retry']>>;
export type _RegenerateOptional = Expect<Assignable<undefined, Agent['regenerate']>>;
export type _CheckStatusOptional = Expect<Assignable<undefined, Agent['checkStatus']>>;
export type _ResumeOptional = Expect<Assignable<undefined, Agent['resume']>>;
export type _ClientToolsOptional = Expect<Assignable<undefined, Agent['clientTools']>>;
export type _RegenerateById = Expect<
  Equal<Parameters<NonNullable<Agent['regenerate']>>[0], string>
>;

// The legacy members are gone, not renamed in place.
export type _NoIsLoading = Expect<Equal<'isLoading' extends keyof Agent ? true : false, false>>;
export type _NoEvents = Expect<Equal<'events$' extends keyof Agent ? true : false, false>>;
export type _NoInterrupt = Expect<Equal<'interrupt' extends keyof Agent ? true : false, false>>;
export type _NoHistory = Expect<Equal<'history' extends keyof Agent ? true : false, false>>;

// A mock is an agent, so it binds to `<chat [agent]>` with no cast.
export type _MockIsAgent = Expect<Assignable<MockAgent, Agent>>;

// So is an agent over a session with authored tools and a declared state.
interface TripTools {
  readonly search: { readonly args: { readonly query: string }; readonly result: readonly string[] };
}
interface TripState {
  readonly day: number;
}
export type _TypedIsAgent = Expect<Assignable<InjectedAgent<AgentSession<TripTools, TripState>>, Agent>>;
