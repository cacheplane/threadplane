import { signal, Signal, WritableSignal } from '@angular/core';
import { EMPTY, type Observable } from 'rxjs';
import type {
  Agent,
  Message,
  AgentStatus,
  ToolCall,
  AgentInterrupt,
  Subagent,
  AgentSubmitInput,
  AgentSubmitOptions,
  AgentEvent,
  AgentCheckpoint,
} from '../agent';
import type { AgentError } from '../agent/agent-error';

/** An in-memory agent with writable test signals, captured submissions, and a stop invocation counter. */
export interface MockAgent extends Agent {
  messages:      WritableSignal<Message[]>;
  status:        WritableSignal<AgentStatus>;
  isLoading:     WritableSignal<boolean>;
  error:         WritableSignal<AgentError | undefined>;
  toolCalls:     WritableSignal<ToolCall[]>;
  state:         WritableSignal<Record<string, unknown>>;
  interrupt?:    WritableSignal<AgentInterrupt | undefined>;
  subagents?:    WritableSignal<Map<string, Subagent>>;
  history?:      WritableSignal<AgentCheckpoint[]>;
  events$:       Observable<AgentEvent>;
  /**
   * Minimal lifecycle stub the chat lib's effects subscribe to. We only
   * model the signals the chat composition currently reads; richer adapter
   * lifecycles (langgraph, AG-UI) extend this contract on their own mocks.
   * The public `lifecycle` view is a readonly signal; tests drive the
   * value via `_internal.streamStartedAt.set(...)` below.
   */
  lifecycle: {
    streamStartedAt: Signal<number | null>;
  };
  /**
   * Test-only escape hatch for driving lifecycle signals from a spec. Mirrors
   * the `_internal` pattern used by CHAT_LIFECYCLE so tests can flip the
   * underlying writable without going through a full submit/stream cycle.
   */
  _internal: {
    streamStartedAt: WritableSignal<number | null>;
  };
  /** Captured calls to submit() in order. */
  submitCalls: Array<{ input: AgentSubmitInput; opts?: AgentSubmitOptions }>;
  /** Count of stop() invocations. */
  stopCount: number;
}

/** Initial mock agent state and opt-in interrupt, subagent, history, and event support. */
export interface MockAgentOptions {
  messages?: Message[];
  status?: AgentStatus;
  isLoading?: boolean;
  error?: AgentError;
  toolCalls?: ToolCall[];
  state?: Record<string, unknown>;
  withInterrupt?: boolean;
  withSubagents?: boolean;
  history?: AgentCheckpoint[];
  events$?: Observable<AgentEvent>;
}

/**
 * Build an in-memory {@link Agent} for tests and stories — no transport, no
 * network. Every field is a writable signal so a test can drive UI states
 * (loading, error, interrupts, tool calls, subagents) deterministically.
 *
 * @param opts - Initial values for the mock's signals; all optional.
 * @returns A {@link MockAgent} satisfying the full `Agent` contract.
 * @example
 * ```ts
 * import { staticDelivery } from '@threadplane/chat';
 *
 * const agent = mockAgent({
 *   messages: [{ id: '1', role: 'assistant', content: 'Hi', delivery: staticDelivery('1') }],
 *   isLoading: true,
 * });
 * ```
 */
export function mockAgent(opts: MockAgentOptions = {}): MockAgent {
  const messages  = signal<Message[]>(opts.messages ?? []);
  const status    = signal<AgentStatus>(opts.status ?? 'idle');
  const isLoading = signal<boolean>(opts.isLoading ?? false);
  const error     = signal<AgentError | undefined>(opts.error ?? undefined);
  const toolCalls = signal<ToolCall[]>(opts.toolCalls ?? []);
  const state     = signal<Record<string, unknown>>(opts.state ?? {});

  const interrupt = opts.withInterrupt
    ? signal<AgentInterrupt | undefined>(undefined)
    : undefined;
  const subagents = opts.withSubagents
    ? signal<Map<string, Subagent>>(new Map())
    : undefined;
  const history = opts.history
    ? signal<AgentCheckpoint[]>(opts.history)
    : undefined;

  const submitCalls: MockAgent['submitCalls'] = [];
  let stopCount = 0;

  const streamStartedAt = signal<number | null>(null);

  const agent: MockAgent = {
    messages, status, isLoading, error, toolCalls, state,
    ...(interrupt ? { interrupt } : {}),
    ...(subagents ? { subagents } : {}),
    ...(history   ? { history }   : {}),
    lifecycle: { streamStartedAt: streamStartedAt.asReadonly() },
    _internal: { streamStartedAt },
    events$: opts.events$ ?? EMPTY,
    submit: async (input, submitOpts) => { submitCalls.push({ input, opts: submitOpts }); },
    stop: async () => { stopCount++; },
    retry: async () => { return; },
    regenerate: async (assistantMessageIndex: number) => {
      // Truncate messages [N..end] and record the call as a synthetic submit so
      // tests can assert regenerate behavior via the same submitCalls log.
      const current = messages();
      messages.set(current.slice(0, assistantMessageIndex));
      submitCalls.push({ input: { regenerate: { assistantMessageIndex } } as never, opts: undefined });
    },
    submitCalls,
    get stopCount() { return stopCount; },
  };

  return agent;
}
