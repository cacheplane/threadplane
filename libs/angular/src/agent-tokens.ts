import { InjectionToken, type Provider } from '@angular/core';

/**
 * App-wide tuning for the client a session talks to its backend with, such as
 * a retry budget or default headers. The shape belongs to the backend, so this
 * layer carries it untouched.
 *
 * Provide it once at the application root. Each agent reads it when it creates
 * a session and passes it to the session factory as `context.clientOptions`.
 * A factory that has options of its own prefers them:
 * `clientOptions: mine ?? context.clientOptions`.
 */
export const AGENT_CLIENT_OPTIONS = new InjectionToken<object>(
  'AGENT_CLIENT_OPTIONS'
);

/** Provides {@link AGENT_CLIENT_OPTIONS} for every agent below this injector. */
export function provideAgentClientOptions(options: object): Provider {
  return { provide: AGENT_CLIENT_OPTIONS, useValue: options };
}

/**
 * Receives the class of a backend request that failed in a way the host can
 * act on: a rejected credential, or a request the network refused.
 */
export type AgentOperationFailureReporter = (
  code: 'unauthorized' | 'network_blocked'
) => void;

/**
 * @internal Host-only operation failure reporter. Each agent reads it when it
 * creates a session and passes it to the session factory as
 * `context.reportOperationFailure`.
 */
export const ɵAGENT_OPERATION_FAILURE_REPORTER =
  new InjectionToken<AgentOperationFailureReporter>(
    'ɵAGENT_OPERATION_FAILURE_REPORTER'
  );
