import type { Signal } from '@angular/core';
import type { Observable } from 'rxjs';
import type { Message } from './message';
import type { ToolCall } from './tool-call';
import type { AgentStatus } from './agent-status';
import type { AgentInterrupt } from './agent-interrupt';
import type { Subagent } from './subagent';
import type { AgentEvent } from './agent-event';
import type { AgentSubmitInput, AgentSubmitOptions } from './agent-submit';
import type { ClientToolsCapability } from '../client-tools/client-tools-capability';
import type { AgentError } from './agent-error';

/**
 * Runtime-neutral contract chat primitives consume.
 *
 * Implementations are produced by runtime adapters (e.g. a LangGraph or
 * AG-UI adapter) or by user code for custom backends.
 *
 * `interrupt` and `subagents` are optional: runtimes that do not support these
 * concepts should leave them undefined, and primitives that need them check
 * presence and render a neutral fallback when absent.
 *
 * Invariant: state lives on signals; `events$` carries only things that are
 * not derivable from signals.
 */
export interface Agent<TState = unknown> {
  // Core state
  messages:  Signal<Message[]>;
  status:    Signal<AgentStatus>;
  isLoading: Signal<boolean>;
  /** Optional gate for ordinary composer input while the runtime requires resolution or recovery. Resume actions remain adapter-controlled. */
  isInputBlocked?: Signal<boolean>;
  error:     Signal<AgentError | undefined>;
  toolCalls: Signal<ToolCall[]>;
  state:     Signal<TState>;

  // Actions
  submit: (input: AgentSubmitInput, opts?: AgentSubmitOptions) => Promise<void>;
  stop:   () => Promise<void>;

  /**
   * Re-run the captured submission after a failure, including a resume command
   * with no message payload. Does not append another user message or reuse an
   * aborted request signal. Does not restart an in-flight request; no-op when
   * nothing is saved.
   * Adapters may reject unsafe resume retries until the backend outcome has
   * been reconciled; a transport failure alone does not prove non-execution.
   */
  retry: () => Promise<void>;

  /**
   * Discards the assistant message at the given index AND all messages after
   * it, then re-runs the agent against the trimmed conversation tail. The
   * preceding user message (at index - 1) is preserved and re-submitted as
   * the agent's input. No new user message is added to the history.
   *
   * Throws if the message at `index` is not 'assistant' role, or if the
   * agent is currently loading another response.
   */
  regenerate: (assistantMessageIndex: number) => Promise<void>;

  // Extended (optional; absent when runtime does not support)
  /**
   * Optional display projection of the pending interrupt. A runtime may expose
   * a separate full batch and lifecycle surface. A cleared display projection
   * does not by itself prove that resumed backend work completed.
   */
  interrupt?: Signal<AgentInterrupt | undefined>;
  subagents?: Signal<Map<string, Subagent>>;
  /** Optional: client-declared, client-executed tools (see ClientToolsCapability). */
  clientTools?: ClientToolsCapability;

  /**
   * Optional read-only reconciliation of an uncertain run outcome, offered when
   * `error().recovery === 'check'`. Asks the backend what happened.
   *
   * The answer arrives on the signals, not in the return value: a run the
   * backend reports as finished clears `error` and returns `status` to idle,
   * and any messages it committed appear on `messages`. An outcome that stays
   * unknown leaves the existing error in place, so the caller can offer the
   * check again later.
   *
   * Adapters implementing this must not resubmit the operation and must not
   * append a message; a dropped stream is not proof that the server did
   * nothing. They should reject while a request is in flight, and must discard
   * a result that resolves after a newer request has started.
   */
  checkStatus?: () => Promise<void>;

  // Events stream (required; emit EMPTY if runtime produces no events)
  events$: Observable<AgentEvent>;
}
