// Test helpers for apps and backends that render through `@threadplane/chat`.
//
// - `mockAgent()`: an `Agent` with writable fields and recorded commands, for
//   component tests that need no injector.
// - `provideAgentValue()`: makes `injectAgent()` return an agent the test
//   already has, such as that mock.
// - `provideFakeAgent()` / `injectFakeAgentSession()`: the real injected agent
//   over an in-memory session, for tests that go through `injectAgent()`.
// - `createFakeAgentSession()`: the session underneath both.
// - `run*Conformance`: the core session conformance suites, bound to Vitest.
export { mockAgent } from '@threadplane/chat';
export type { MockAgent, MockAgentField, MockAgentLifecycle, MockAgentOptions } from '@threadplane/chat';
export { injectFakeAgentSession, provideAgentValue, provideFakeAgent } from '@threadplane/angular/testing';
export type { FakeAgentConfig } from '@threadplane/angular/testing';
export {
  assertReasoningFixtureMessages,
  createFakeAgentSession,
  historyConformanceCheckpoints,
  interruptConformanceBatch,
  reasoningFixture,
} from '@threadplane/core/testing';
export type {
  FakeAgentSession,
  FakeAgentSessionInit,
  FakeAgentSnapshotPatch,
  FakeAssistantStream,
  FakeCommand,
  FakeMessageInput,
  FakeSubagentInput,
  HistoryConformanceFactory,
  InterruptConformanceHarness,
  InterruptConformanceOptions,
  InterruptConformanceRequest,
  ReasoningFixture,
  ReasoningFixtureEvent,
} from '@threadplane/core/testing';
export {
  runAgentConformance,
  runAgentWithHistoryConformance,
  runInterruptConformance,
} from './conformance';
