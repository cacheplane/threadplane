import { signal, type Provider } from '@angular/core';
import type { AgentSession } from '@threadplane/core';
import {
  AGENT_LIFECYCLE,
  ɵAGENT,
  ɵisAgentRef,
  type Agent,
  type AgentLifecycle,
  type AgentRef,
  type AgentSessionLike,
} from '@threadplane/angular';

const LIFECYCLE_KEYS = [
  'streamStartedAt',
  'streamErrorAt',
  'interruptReceivedAt',
  'interruptResolvedAt',
  'threadCreatedAt',
  'threadPersistedAt',
  'toolCallStartedAt',
  'toolCallCompletedAt',
] as const satisfies readonly (keyof AgentLifecycle)[];

/** The lifecycle of an agent that has none: every milestone stays null. */
function inertLifecycle(): AgentLifecycle {
  return Object.freeze(
    Object.fromEntries(
      LIFECYCLE_KEYS.map((key) => [key, signal(null).asReadonly()])
    )
  ) as unknown as AgentLifecycle;
}

function lifecycleOf(agent: object): AgentLifecycle {
  const lifecycle = (agent as { lifecycle?: unknown }).lifecycle;
  return lifecycle && typeof lifecycle === 'object'
    ? (lifecycle as AgentLifecycle)
    : inertLifecycle();
}

/**
 * Provides an agent a test already holds, so the component under test receives
 * that exact object from `injectAgent()`. Use it to hand a component a mock,
 * such as `mockAgent()` from `@threadplane/angular/chat`, or any hand-built agent.
 * Where the test wants the real agent over an in-memory session instead, use
 * `provideFakeAgent`.
 *
 * Pass an {@link AgentRef} first to answer `injectAgent(ref)` as well. As with
 * `provideAgent(ref, …)`, the ref-less `injectAgent()` at that injector level
 * then returns the same agent, and the last provider wins when several are
 * given. Under a ref declared with a backend's session type the agent may be a
 * core-shaped mock: a member only the backend has is then `undefined` on it,
 * so add the members the component under test calls.
 *
 * `AGENT_LIFECYCLE` resolves to the agent's own `lifecycle` object, so a mock's
 * writable marks drive whatever reads the token. An agent with no `lifecycle`
 * gets one whose milestones all stay null.
 *
 * The test owns the agent. The injector does not stop or dispose it, does not
 * list it in `AgentLifecycleRegistry`, and does not register it for
 * development-install collection.
 *
 * @example
 * ```ts
 * const agent = mockAgent({ status: 'running' });
 * TestBed.configureTestingModule({ providers: [provideAgentValue(agent)] });
 * ```
 */
export function provideAgentValue<TSession extends AgentSessionLike>(
  ref: AgentRef<TSession>,
  agent: Agent<NoInfer<TSession>> | Agent
): Provider[];
export function provideAgentValue<
  TSession extends AgentSessionLike = AgentSession
>(agent: Agent<TSession>): Provider[];
export function provideAgentValue(
  refOrAgent: AgentRef<never> | object,
  maybeAgent?: object
): Provider[] {
  const ref =
    maybeAgent !== undefined && ɵisAgentRef(refOrAgent)
      ? refOrAgent
      : undefined;
  const agent = ref ? maybeAgent : refOrAgent;
  if ((typeof agent !== 'object' && typeof agent !== 'function') || !agent)
    throw new TypeError('provideAgentValue: an agent object is required.');
  const lifecycle = lifecycleOf(agent);
  return [
    ...(ref ? [{ provide: ref.token, useValue: agent }] : []),
    { provide: ɵAGENT, useValue: agent },
    { provide: AGENT_LIFECYCLE, useValue: lifecycle },
  ];
}
