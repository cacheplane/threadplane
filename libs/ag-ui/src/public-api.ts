// The public surface of @threadplane/ag-ui. Framework-neutral: no module in
// this graph imports a UI framework. The README lists every name below.

// The session factory, its options and its commands.
export { createSession } from './runtime/create-session.js';
export type {
  AgentSessionSource,
  ClientToolSession,
  DeclaredSessionOptions,
  HttpSessionSource,
  ResumeOptions,
  Session,
  SessionCommonOptions,
  SessionOptions,
} from './runtime/create-session.js';
export type { SessionAgent } from './runtime/create-http-request.js';
export type { DurabilityOptions } from './runtime/durability.js';
export type {
  OperationFailureCode,
  OperationFailureReporter,
} from './runtime/protected-fetch.js';
export type {
  ApplicationState,
  SubmitInput,
  SubmitState,
} from './runtime/submit-input.js';

// The snapshot a session publishes.
export type {
  InputBlock,
  SessionInputBlock,
  SessionInterrupt,
  SessionSnapshot,
} from './runtime/agent-session.js';
export type {
  ClientToolBlocker,
  ClientToolCall,
  ClientToolSessionSnapshot,
} from './runtime/client-tools.js';
export type { SessionSubagent } from './runtime/child-projection.js';
export type {
  Observation,
  OwnedLegacyInterrupt,
  OwnedRootTerminal,
} from './runtime/session-observation.js';
export type {
  ChildError,
  ChildFinish,
  ChildStart,
  SubagentObservation,
  Subagents,
} from './runtime/subagents.js';
export type { Transcript } from './runtime/transcript.js';
export type {
  SessionLifecycle,
  SessionLifecycleSource,
} from './runtime/lifecycle.js';

// Selectors over a snapshot: core messages and tool calls, and plain text rows.
export {
  projectMessages,
  projectStreamingToolCalls,
  projectToolCalls,
} from './runtime/message-projection.js';
export type { Projectable } from './runtime/message-projection.js';
export { projectTextTranscript } from './runtime/text-transcript.js';
export type { TextTranscriptRow } from './runtime/text-transcript.js';
export { bridgeCitationsState } from './runtime/bridge-citations-state.js';

// Pauses and their answers.
export { decisionState, interruptSession } from './runtime/decision.js';
export type {
  CommandProps,
  Decision,
  DecisionRun,
  DecisionState,
  InterruptResponse,
  InterruptSession,
  NativeDecision,
  NativeResponse,
  OwnedInterrupt,
  PauseId,
} from './runtime/decision.js';
export type {
  InterruptMode,
  InterruptTransport,
} from './runtime/interrupt-mode.js';

// Restoring a thread: replay from the backend, and saved threads.
export { httpReplay } from './runtime/replay.js';
export type {
  HttpReplayOptions,
  ReplaySource,
  ReplaySubscribable,
} from './runtime/replay.js';
export type {
  ReconcileAnswer,
  SavedPause,
  SessionPersistence,
  ThreadContent,
  ThreadRecord,
} from './runtime/thread-store.js';

// Host hooks: telemetry and devtools.
export type {
  InstrumentOptions,
  ScriptedRun,
  SessionDevelopmentInstall,
  SessionDevelopmentRuntime,
  SessionDevelopmentRuntimeFactory,
  SessionDevtools,
  SessionRequestType,
  SessionTelemetryEvent,
  SessionTelemetryProperties,
  SessionTelemetrySink,
} from './runtime/session-instruments.js';

// An in-process AG-UI agent for tests and offline demos. Not for production use.
export { FakeAgent } from './runtime/fake-agent.js';
export type { FakeAgentScript } from './runtime/fake-agent.js';
