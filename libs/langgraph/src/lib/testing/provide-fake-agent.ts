import { type Provider } from '@angular/core';
import type { FakeAgentConfig } from '@threadplane/chat/testing';
import { provideAgent } from '../agent.provider';
import { FakeStreamTransport } from './fake-stream.transport';

/**
 * Wire an in-process fake LangGraph agent into Angular DI.
 *
 * Streams a canned assistant reply (see FakeAgentConfig) with no backend —
 * the symmetric counterpart to `@threadplane/ag-ui`'s `provideFakeAgent()`. For
 * advanced manual scripting (tool calls, interrupts, multi-batch), provide
 * the agent yourself with
 * `provideAgent({ assistantId, transport: new MockAgentTransport(...) })`.
 *
 * @example
 * ```ts
 * TestBed.configureTestingModule({
 *   providers: [provideFakeAgent({ tokens: ['Hi from the fake LangGraph agent'] })],
 * });
 * ```
 */
export function provideFakeAgent(config: FakeAgentConfig = {}): Provider[] {
  return provideAgent({
    assistantId: 'fake',
    transport: new FakeStreamTransport(config),
  });
}
