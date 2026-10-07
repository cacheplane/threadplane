// libs/ag-ui/src/lib/testing/provide-fake-agent.ts
import { DestroyRef, inject, type Provider } from '@angular/core';
import type { FakeAgentConfig } from '@threadplane/chat/testing';
import { AGENT } from '../provide-agent';
import { toAgent } from '../to-agent';
import { FakeAgent, type FakeAgentScript } from './fake-agent';

/**
 * Config accepted by {@link provideFakeAgent}: the shared `FakeAgentConfig`
 * (`tokens`, `reasoningTokens`, `delayMs`) plus the AG-UI-only `script`, which
 * replaces the canned token reply with raw AG-UI events.
 */
export interface AgUiFakeAgentConfig extends FakeAgentConfig {
  /** Deterministic event branches — see {@link FakeAgentScript}. */
  script?: FakeAgentScript;
}

/**
 * Registers an in-process FakeAgent under AGENT.
 *
 * Use for offline demos and development. Drop-in replacement for
 * provideAgent({ url }) when no real backend is available.
 *
 * Pass `script` to stream exact AG-UI events instead of the canned token
 * reply — the adapter reduces them into `toolCalls()`, `state()`,
 * `customEvents()`, and `interrupt()` exactly as it would real wire events,
 * and emits each one on `rawEvents$`.
 *
 * @example
 * ```ts
 * TestBed.configureTestingModule({
 *   providers: [provideFakeAgent({ tokens: ['Hello from the fake agent'] })],
 * });
 * ```
 *
 * @example Scripted tool call
 * ```ts
 * TestBed.configureTestingModule({
 *   providers: [provideFakeAgent({
 *     delayMs: 0,
 *     script: [{
 *       when: 'initial',
 *       events: [
 *         { type: EventType.TOOL_CALL_START, toolCallId: 't1', toolCallName: 'get_weather' },
 *         { type: EventType.TOOL_CALL_ARGS, toolCallId: 't1', delta: '{"city":"SF"}' },
 *         { type: EventType.TOOL_CALL_END, toolCallId: 't1' },
 *       ] as BaseEvent[],
 *     }],
 *   })],
 * });
 * ```
 */
export function provideFakeAgent(config: AgUiFakeAgentConfig = {}): Provider[] {
  return [
    {
      provide: AGENT,
      useFactory: () => {
        const adapter = toAgent(new FakeAgent(config));
        inject(DestroyRef).onDestroy(() => adapter.dispose());
        return adapter;
      },
    },
  ];
}
