import { InjectionToken } from '@angular/core';
import type { Agent } from './agent';

/** A typed handle that threads a state shape through Angular DI from
 *  `provideAgent(ref, …)` to `injectAgent(ref)` without per-call-site
 *  restatement of the generic. */
export interface AgentRef<TState> {
  readonly token: InjectionToken<Agent<TState>>;
}

/**
 * Create a typed agent handle.
 *
 * @param debugName - Optional name shown in Angular DI error messages.
 * @returns An {@link AgentRef} carrying a state-typed `InjectionToken`.
 * @example
 * ```ts
 * interface TripState { day: number; places: string[]; }
 * export const TRIP = createAgentRef<TripState>('trip');
 * // app.config.ts: provideAgent(TRIP, { assistantId: 'trip' })
 * // component:     const agent = injectAgent(TRIP); // LangGraphAgent<TripState>
 * ```
 */
export function createAgentRef<TState>(debugName?: string): AgentRef<TState> {
  return { token: new InjectionToken<Agent<TState>>(debugName ?? 'ThreadplaneAgent') };
}
