import { InjectionToken, Signal } from '@angular/core';
import type { AgentErrorKind } from '@threadplane/chat';

/** Reactive timestamps for LangGraph streaming, interrupt, thread, and tool-call milestones, reset when the agent switches threads. */
export interface AgentLifecycle {
  /** Epoch ms of the first stream chunk arrival. Resets on switchThread(). */
  readonly streamStartedAt: Signal<number | null>;
  /**
   * Epoch ms + failure class of the most recent stream error. Resets on switchThread().
   *
   * `kind` is the {@link AgentErrorKind} of the normalized `AgentError`
   * (`connection` | `auth` | `server` | `interrupted` | `aborted`) — the same
   * value `agent.error()?.kind` carries. For a failure the runtime could not
   * normalize it falls back to the error's constructor name.
   */
  readonly streamErrorAt: Signal<{ at: number; kind: AgentErrorKind | string } | null>;
  /** Epoch ms of the first interrupt$ non-null in this stream. Resets on switchThread(). */
  readonly interruptReceivedAt: Signal<number | null>;
  /** Epoch ms of the most recent submit({ resume }) call. Resets on switchThread(). */
  readonly interruptResolvedAt: Signal<number | null>;
  /** Epoch ms when the agent's "create new thread" branch fired. Resets on switchThread(). */
  readonly threadCreatedAt: Signal<number | null>;
  /** Epoch ms when an existing thread was restored from server (proves persistence). Resets on switchThread(). */
  readonly threadPersistedAt: Signal<number | null>;
  /** Epoch ms of the first tool call append. Resets on switchThread(). */
  readonly toolCallStartedAt: Signal<number | null>;
  /** Epoch ms of the first tool call result transition. Resets on switchThread(). */
  readonly toolCallCompletedAt: Signal<number | null>;
}

/** Injection token exposing the lifecycle signals of the LangGraph agent provided in the current injector. */
export const AGENT_LIFECYCLE = new InjectionToken<AgentLifecycle>('AGENT_LIFECYCLE');
