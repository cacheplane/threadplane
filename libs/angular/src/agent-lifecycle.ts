import {
  Injectable,
  InjectionToken,
  signal,
  type Signal,
} from '@angular/core';
import type { AgentErrorKind } from '@threadplane/core';

/**
 * When the injected agent first saw each milestone, in epoch milliseconds.
 * Every value is null until its milestone happens, and all of them return to
 * null when the agent switches threads.
 *
 * The values come from the session's own `lifecycle` source. A session that
 * publishes none leaves them null, apart from `threadCreatedAt`, which the
 * agent records when a session reports the thread it created.
 */
export interface AgentLifecycle {
  /** The first event to arrive on any run's stream. */
  readonly streamStartedAt: Signal<number | null>;
  /**
   * The most recent failure the session published, with its error kind: the
   * same value `agent.error()?.kind` carries.
   */
  readonly streamErrorAt: Signal<{
    readonly at: number;
    readonly kind: AgentErrorKind | string;
  } | null>;
  /** The first time the session held a pending interrupt. */
  readonly interruptReceivedAt: Signal<number | null>;
  /** The most recent `resume` the session accepted. */
  readonly interruptResolvedAt: Signal<number | null>;
  /** When a session reported the thread it created for its first submit. */
  readonly threadCreatedAt: Signal<number | null>;
  /** The first history read that returned saved data for the thread. */
  readonly threadPersistedAt: Signal<number | null>;
  /** The first time the session held a tool call. */
  readonly toolCallStartedAt: Signal<number | null>;
  /** The first time a tool call was complete or failed. */
  readonly toolCallCompletedAt: Signal<number | null>;
}

/**
 * The lifecycle of the agent provided in the current injector: the same object
 * as `injectAgent().lifecycle`. With several agent refs at one injector level
 * it follows the ref-less `injectAgent()` and names the last one provided.
 */
export const AGENT_LIFECYCLE = new InjectionToken<AgentLifecycle>(
  'AGENT_LIFECYCLE'
);

/**
 * Application-wide registry of every live agent's {@link AgentLifecycle}.
 *
 * It is provided in the root injector, so an agent created in a route or
 * component injector is still visible from the root. Instrumentation reads
 * `lifecycles()` to observe every agent without owning the provider graph.
 *
 * An agent registers when it is created and unregisters when the injector that
 * created it is destroyed. Its lifecycle object stays the same across thread
 * switches.
 */
@Injectable({ providedIn: 'root' })
export class AgentLifecycleRegistry {
  private readonly registered = signal<readonly AgentLifecycle[]>([]);

  /** The lifecycles of every currently live agent. */
  readonly lifecycles: Signal<readonly AgentLifecycle[]> =
    this.registered.asReadonly();

  register(lifecycle: AgentLifecycle): void {
    this.registered.update((current) => [...current, lifecycle]);
  }

  /** Drops a lifecycle when its agent's injector is destroyed. */
  unregister(lifecycle: AgentLifecycle): void {
    this.registered.update((current) =>
      current.filter((entry) => entry !== lifecycle)
    );
  }
}
