import { computed, signal, untracked, type Signal, type WritableSignal } from '@angular/core';
import type { Agent, AgentLifecycle } from '../agent/angular-agent';
import type {
  AgentCheckpoint,
  AgentError,
  AgentErrorDiagnostic,
  AgentInputBlock,
  AgentInterrupt,
  AgentPlanStep,
  AgentSessionCustomEvent,
  AgentStatus,
  AgentSubagent,
  AgentSubmitInput,
  AgentSubmitOptions,
  AgentUsage,
  Message,
  PlainValue,
  StreamingToolCall,
  ToolCall,
} from '@threadplane/core';
import {
  createFakeAgentSession,
  type FakeAgentSession,
  type FakeAgentSessionInit,
  type FakeCommand,
  type FakeMessageInput,
  type FakeSubagentInput,
} from '@threadplane/core/testing';

/** A snapshot field a test reads like the agent's signal and replaces with `set` or `update`. */
export interface MockAgentField<T, TInput = T> extends Signal<T> {
  set(value: TInput): void;
  update(change: (value: T) => TInput): void;
  asReadonly(): Signal<T>;
}

/** The agent's lifecycle marks, each one writable by a test. */
export type MockAgentLifecycle = {
  readonly [K in keyof AgentLifecycle]: AgentLifecycle[K] extends Signal<infer T> ? WritableSignal<T> : never;
};

/** The members a test replaces on a {@link MockAgent}. */
interface MockAgentMembers {
  readonly status: MockAgentField<AgentStatus>;
  readonly messages: MockAgentField<readonly Message[], readonly FakeMessageInput[]>;
  readonly toolCalls: MockAgentField<readonly ToolCall[]>;
  /** Setting an error also sets the status `'error'`, as a session does; clearing it returns to `'idle'`. */
  readonly error: MockAgentField<AgentError | undefined>;
  readonly errorDiagnostic: MockAgentField<AgentErrorDiagnostic | undefined>;
  readonly plan: MockAgentField<readonly AgentPlanStep[] | undefined>;
  readonly usage: MockAgentField<AgentUsage | undefined>;
  readonly state: MockAgentField<PlainValue, unknown>;
  readonly interrupts: MockAgentField<readonly AgentInterrupt[] | undefined>;
  readonly subagents: MockAgentField<readonly AgentSubagent[] | undefined, readonly FakeSubagentInput[] | undefined>;
  readonly streamingToolCalls: MockAgentField<readonly StreamingToolCall[] | undefined>;
  readonly pendingClientTools: MockAgentField<readonly ToolCall[] | undefined>;
  readonly checkpoints: MockAgentField<readonly AgentCheckpoint[] | undefined>;
  readonly messageCheckpoints: MockAgentField<Readonly<Record<string, string>> | undefined>;
  readonly inputBlocked: MockAgentField<AgentInputBlock | undefined>;
  readonly threadId: WritableSignal<string | null>;
  readonly isThreadLoading: WritableSignal<boolean>;
  readonly customEvents: WritableSignal<readonly AgentSessionCustomEvent[]>;
  readonly lifecycle: MockAgentLifecycle;
}

/**
 * An in-memory {@link Agent} for tests and stories: the agent's own shape, with
 * every snapshot field writable and every command recorded. It stands on the
 * fake session from `@threadplane/core/testing`, reachable as `fake` for its
 * streaming helper and its full call log.
 */
export type MockAgent = Omit<Agent, keyof MockAgentMembers> &
  MockAgentMembers & {
    /** The fake session underneath: `stream()`, `push()`, `resumes`, `regenerates`, `catalogs` and the rest. */
    readonly fake: FakeAgentSession;
    /** Calls to `submit` in order. */
    readonly submitCalls: readonly { readonly input: AgentSubmitInput; readonly opts?: AgentSubmitOptions }[];
    /** Count of `stop` calls. */
    readonly stopCount: number;
    /** Every id passed to `switchThread`, in order. */
    readonly switchThreadCalls: readonly (string | null)[];
    /** Delivers a custom event to `onCustomEvent` listeners and appends it to `customEvents`. */
    emitCustomEvent(name: string, data?: PlainValue): void;
  };

/** Initial values for a {@link MockAgent}, and which optional commands it carries. */
export interface MockAgentOptions extends Omit<FakeAgentSessionInit, 'commands' | 'stateType'> {
  /**
   * The optional commands the agent carries. Defaults to `regenerate`, `retry`
   * and `onCustomEvent`; `resume` is always present. Pass a list to add
   * `checkStatus`, `runWithoutMessage` or `clientTools`, or to leave some out
   * so a view under test offers no control for them.
   */
  readonly commands?: readonly FakeCommand[];
  readonly threadId?: string | null;
  readonly isThreadLoading?: boolean;
}

const DEFAULT_COMMANDS: readonly FakeCommand[] = ['regenerate', 'retry', 'onCustomEvent'];

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

/**
 * Builds an in-memory {@link Agent} for tests and stories, with no transport
 * and no injection context. Read it as a component does (`agent.messages()`,
 * `agent.status()`), drive it with setters (`agent.messages.set([...])`,
 * `agent.status.set('running')`, `agent.error.set(...)`), and assert on what
 * was called (`agent.submitCalls`, `agent.stopCount`, `agent.fake.resumes`).
 *
 * `submit` appends the user message, as a session does. To stream a reply use
 * `agent.fake.stream()`.
 *
 * @example
 * ```ts
 * const agent = mockAgent({
 *   messages: [{ id: '1', role: 'assistant', content: 'Hi' }],
 *   status: 'running',
 * });
 * agent.status.set('idle');
 * ```
 */
export function mockAgent(opts: MockAgentOptions = {}): MockAgent {
  const { commands, threadId: initialThreadId, isThreadLoading: initialLoading, ...init } = opts;
  const fake = createFakeAgentSession({ ...init, commands: commands ?? DEFAULT_COMMANDS });
  const session = fake.session;
  const source = signal(session.getSnapshot());
  session.subscribe(() => source.set(session.getSnapshot()));

  type Snapshot = ReturnType<typeof session.getSnapshot>;
  const field = <K extends keyof Snapshot>(key: K, write: (value: never) => void) => {
    const read = computed(() => source()[key]);
    return Object.assign(read, {
      set: (value: never) => write(value),
      update: (change: (value: Snapshot[K]) => never) => write(change(untracked(read))),
      asReadonly: () => read,
    });
  };
  const patch = <K extends keyof Snapshot>(key: K) =>
    field(key, (value) => fake.set({ [key]: value } as never));

  const threadId = signal<string | null>(initialThreadId ?? null);
  const isThreadLoading = signal(initialLoading ?? false);
  const customEvents = signal<readonly AgentSessionCustomEvent[]>([]);
  const lifecycle = Object.fromEntries(LIFECYCLE_KEYS.map((key) => [key, signal(null)])) as unknown as MockAgentLifecycle;
  const switchThreadCalls: (string | null)[] = [];
  const stopListeners = new Set<() => void>();
  const sessionEpoch = signal(0);
  if (session.onCustomEvent) session.onCustomEvent((event) => customEvents.update((events) => [...events, event]));

  const members: MockAgentMembers = {
    status: patch('status'),
    messages: patch('messages'),
    toolCalls: patch('toolCalls'),
    error: field('error', (error: AgentError | undefined) => fake.setError(error)),
    errorDiagnostic: patch('errorDiagnostic'),
    plan: patch('plan'),
    usage: patch('usage'),
    state: patch('state'),
    interrupts: patch('interrupts'),
    subagents: patch('subagents'),
    streamingToolCalls: patch('streamingToolCalls'),
    pendingClientTools: patch('pendingClientTools'),
    checkpoints: patch('checkpoints'),
    messageCheckpoints: patch('messageCheckpoints'),
    inputBlocked: patch('inputBlocked'),
    threadId,
    isThreadLoading,
    customEvents,
    lifecycle,
  } as MockAgentMembers;

  const bind = <K extends keyof typeof session>(key: K) => {
    const member = session[key];
    return typeof member === 'function' ? (member as (...args: never[]) => unknown).bind(session) : member;
  };

  const agent = {
    ...members,
    submit: bind('submit'),
    stop: (() => {
      const stop = session.stop.bind(session);
      return () => {
        for (const listener of [...stopListeners]) listener();
        return stop();
      };
    })(),
    sessionEpoch: sessionEpoch.asReadonly(),
    onStop(listener: () => void): () => void {
      stopListeners.add(listener);
      return () => {
        stopListeners.delete(listener);
      };
    },
    resume: bind('resume'),
    regenerate: bind('regenerate'),
    retry: bind('retry'),
    checkStatus: bind('checkStatus'),
    runWithoutMessage: bind('runWithoutMessage'),
    onCustomEvent: bind('onCustomEvent'),
    clientTools: session.clientTools,
    switchThread(next: string | null) {
      switchThreadCalls.push(next);
      threadId.set(next);
      customEvents.set([]);
    },
    fake,
    get submitCalls() {
      return fake.submits.map(({ input, options }) => (options ? { input, opts: options } : { input }));
    },
    get stopCount() {
      return fake.stopCount;
    },
    switchThreadCalls,
    emitCustomEvent: (name: string, data?: PlainValue) => fake.emitCustomEvent(name, data),
  };
  return agent as unknown as MockAgent;
}
