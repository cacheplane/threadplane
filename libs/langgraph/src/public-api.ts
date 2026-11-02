// Provider
export { provideAgent } from './lib/agent.provider';
export type { AgentConfig } from './lib/agent.provider';

// Symmetric inject helper — matches @threadplane/ag-ui's injectAgent()
export { injectAgent } from './lib/inject-agent';

// Lifecycle monitoring
export { AGENT_LIFECYCLE } from './lib/lifecycle';
export type { AgentLifecycle } from './lib/lifecycle';
export { AgentLifecycleRegistry } from './lib/agent-lifecycle-registry';

// Public types
export type {
  AgentOptions,
  LangGraphClientOptions,
  AgentBranchTree,
  AgentBranchTreeFork,
  AgentBranchTreeNode,
  AgentQueue,
  AgentQueueEntry,
  LangGraphAgent,
  LangGraphMultitaskStrategy,
  LangGraphSubmitOptions,
  AgentTransport,
  CustomStreamEvent,
  StreamEvent,
  SubagentStreamRef,
} from './lib/agent.types';

// Re-export from SDK (consumers import from angular, not langgraph-sdk)
export type {
  BagTemplate,
  InferBag,
  Interrupt,
  /** LangGraph SDK checkpoint snapshot containing state values, next nodes, metadata, parent checkpoint, and pending tasks. */
  ThreadState,
  /** LangGraph SDK run-submission options, including configuration, context, checkpoint, commands, streaming, and optimistic state. */
  SubmitOptions
}
  from './lib/agent.types';

// Re-export ResourceStatus shim for convenience
export { ResourceStatus } from './lib/agent.types';

// Test utilities (always exported — tree-shaken in prod builds)
export { MockAgentTransport } from './lib/transport/mock-stream.transport';
export { FetchStreamTransport } from './lib/transport/fetch-stream.transport';

// Mock test utility for LangGraph agent
export { mockLangGraphAgent } from './lib/testing/mock-langgraph-agent';
export type { MockLangGraphAgent } from './lib/testing/mock-langgraph-agent';
export { provideFakeAgent } from './lib/testing/provide-fake-agent';
// Low-level auto-emitting fake transport backing provideFakeAgent — exported
// for advanced manual wiring (parity with @threadplane/ag-ui's FakeAgent).
export { FakeStreamTransport } from './lib/testing/fake-stream.transport';

// Citation normalizer — useful for advanced consumers building custom adapters
// or bridging non-LangGraph message shapes into tplane Citation[].
export { extractCitations } from './lib/internals/extract-citations';

// SDK Client helper — handles the SDK's absolute-URL requirement so
// `/api`-style relative paths work in browser contexts.
export { createLangGraphClient, toAbsoluteApiUrl } from './lib/client/create-langgraph-client';
export { LANGGRAPH_CLIENT_OPTIONS } from './lib/client/client-options';
export { ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER } from './lib/runtime-operation-reporter';
export type { RuntimeOperationFailureReporter as ɵLangGraphRuntimeOperationFailureReporter } from './lib/runtime-operation-reporter';

// SDK-backed thread store — drop-in replacement for the
// hand-rolled ThreadsService that consumers used to duplicate.
export {
  LangGraphThreadsAdapter,
  LANGGRAPH_THREADS_CONFIG,
  LANGGRAPH_CLIENT,
} from './lib/threads/threads-adapter';
export type { LangGraphThreadsConfig } from './lib/threads/threads-adapter';

// Lifecycle helper for hooking refreshes onto agent state transitions.
export { refreshOnRunEnd, refreshOnTransition } from './lib/threads/refresh-on';
