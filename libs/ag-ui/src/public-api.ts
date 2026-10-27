export { toAgent } from './lib/to-agent';
export type { ToAgentOptions, AgUiAgent, AgUiSubmitOptions } from './lib/to-agent';
export type { InterruptSessionSnapshot, InterruptSessionPhase, InterruptTransport, ResumeAttempt } from './lib/interrupt-session.types';
export type { AgUiInterruptPersistence, AgUiThreadRecord } from './lib/interrupt-persistence';
export { httpReplay } from './lib/replay';
export type { AgUiReplaySource, HttpReplayOptions } from './lib/replay';
export type { ThreadSnapshot } from './lib/run-state-transaction';
export type { CustomStreamEvent } from './lib/reducer';
export { provideAgent, injectAgent } from './lib/provide-agent';
export type { AgentConfig } from './lib/provide-agent';
export { ɵAG_UI_RUNTIME_OPERATION_REPORTER } from './lib/runtime-operation-reporter';
export type { RuntimeOperationFailureReporter as ɵAgUiRuntimeOperationFailureReporter } from './lib/runtime-operation-reporter';
export { FakeAgent } from './lib/testing/fake-agent';
export type { FakeAgentScript } from './lib/testing/fake-agent';
export { provideFakeAgent } from './lib/testing/provide-fake-agent';
export type { AgUiFakeAgentConfig } from './lib/testing/provide-fake-agent';

// Citation state bridge
export { bridgeCitationsState } from './lib/bridge-citations-state';
