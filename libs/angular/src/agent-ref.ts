import { InjectionToken } from '@angular/core';
import type { AgentSession } from '@threadplane/core';
import type { Agent, AgentSessionLike } from './agent';

/**
 * A typed handle that carries a session type through Angular dependency
 * injection, from `provideAgent(ref, …)` to `injectAgent(ref)`, so no call
 * site restates it.
 */
export interface AgentRef<TSession extends AgentSessionLike = AgentSession> {
  readonly token: InjectionToken<Agent<TSession>>;
}

/**
 * Creates a typed agent handle.
 *
 * @param debugName - Optional name shown in Angular injection errors and in
 * the warning about several refs at one injector level.
 * @example
 * ```ts
 * export const TRIP = createAgentRef<TripSession>('trip');
 * // app.config.ts: provideAgent(TRIP, { createSession: … })
 * // component:     const agent = injectAgent(TRIP); // Agent<TripSession>
 * ```
 */
export function createAgentRef<
  TSession extends AgentSessionLike = AgentSession
>(debugName?: string): AgentRef<TSession> {
  return {
    token: new InjectionToken<Agent<TSession>>(debugName ?? 'ThreadplaneAgent'),
  };
}
