import type {
  AgentResumeOptions,
  AgentSession,
  AgentSessionCustomEvent,
  AgentSubmitInput,
  AgentSubmitOptions,
} from '../contracts/agent-session.js';
import type {
  AgentInputBlock,
  AgentStatus,
  AgentUsage,
} from '../contracts/agent-snapshot.js';
import type { AgentCheckpoint } from '../contracts/checkpoint.js';
import type {
  ClientToolResult,
  ClientToolSpec,
} from '../contracts/client-tools.js';
import {
  completeDelivery,
  staticDelivery,
  streamingDelivery,
  type CompleteOutcome,
  type MessageDelivery,
} from '../contracts/delivery.js';
import {
  projectAgentError,
  projectErrorDiagnostic,
  type AgentError,
  type AgentErrorDiagnostic,
} from '../contracts/error.js';
import type { Message } from '../contracts/message.js';
import type {
  AgentInterrupt,
  AgentInterruptResponse,
} from '../contracts/interrupt.js';
import type { AgentPlanStep } from '../contracts/plan.js';
import type {
  AgentSubagent,
  AgentSubagentStatus,
} from '../contracts/subagent.js';
import {
  readState,
  type AgentStateUpdate,
  type StateDeclaration,
} from '../contracts/state.js';
import type {
  DeepReadonly,
  PlainValue,
  StreamingToolCall,
  ToolCall,
  ToolContract,
} from '../contracts/tool.js';

/** A message to place in a fake snapshot. The id defaults to a generated one
 * and the delivery to a complete, successful static delivery. */
export type FakeMessageInput = Omit<Message, 'id' | 'delivery'> & {
  readonly id?: string;
  readonly delivery?: MessageDelivery;
};

/** A child agent to place in a fake snapshot. The status defaults to
 * `'complete'`, and its messages take the same defaults as root messages. */
export type FakeSubagentInput = Omit<
  AgentSubagent,
  'status' | 'messages' | 'toolCalls'
> & {
  readonly status?: AgentSubagentStatus;
  readonly messages?: readonly FakeMessageInput[];
  readonly toolCalls?: readonly ToolCall[];
};

/** Snapshot fields a test may replace. Omitted fields keep their value; an
 * explicit `undefined` for any field but `status`, `messages` and `toolCalls`
 * removes the field. `state` replaces the whole state and is checked against the
 * session's `stateType` when that is a schema. */
export interface FakeAgentSnapshotPatch<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >,
  TState = unknown
> {
  readonly status?: AgentStatus;
  readonly messages?: readonly FakeMessageInput[];
  readonly toolCalls?: readonly ToolCall<TTools>[];
  readonly error?: AgentError;
  readonly plan?: readonly AgentPlanStep[];
  readonly state?: NoInfer<TState> | DeepReadonly<NoInfer<TState>>;
  readonly interrupts?: readonly AgentInterrupt[];
  readonly subagents?: readonly FakeSubagentInput[];
  readonly errorDiagnostic?: AgentErrorDiagnostic;
  readonly usage?: AgentUsage;
  readonly streamingToolCalls?: readonly StreamingToolCall[];
  readonly pendingClientTools?: readonly ToolCall<TTools>[];
  readonly checkpoints?: readonly AgentCheckpoint[];
  readonly messageCheckpoints?: Readonly<Record<string, string>>;
  readonly inputBlocked?: AgentInputBlock;
}

/** One recorded call to `session.resume`. */
export interface FakeResumeCall<TState = unknown> {
  readonly responses: readonly AgentInterruptResponse[];
  readonly options?: AgentResumeOptions<TState>;
}

/** One recorded call to `session.runWithoutMessage`. */
export interface FakeRunCall<TState = unknown> {
  readonly input?: { readonly state?: AgentStateUpdate<TState> };
  readonly options?: AgentSubmitOptions;
}

/** One recorded call to `session.regenerate`. */
export interface FakeRegenerateCall {
  readonly messageId: string;
  readonly options?: AgentSubmitOptions;
}

/** One result a caller gave through `session.clientTools`. */
export interface FakeClientToolSettlement {
  /** `settle` records the result; `resolve` also continues the run. */
  readonly kind: 'settle' | 'resolve';
  readonly toolCallId: string;
  readonly result: ClientToolResult;
}

/**
 * An optional session member the fake can carry. `resume` is always present;
 * each of these is present only when listed in `commands` or when its handler
 * is given, so a view under test offers no control the test did not ask for.
 */
export type FakeCommand =
  | 'runWithoutMessage'
  | 'regenerate'
  | 'retry'
  | 'checkStatus'
  | 'onCustomEvent'
  | 'clientTools';

/**
 * Runs after the fake removes the answered interrupts from the snapshot.
 * Return the outcome `resume` resolves with; nothing means `'paused'` while
 * interrupts remain and `'success'` otherwise. Throwing rejects `resume` with
 * that error.
 */
export type FakeResumeHandler<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >,
  TState = unknown
> = (
  responses: readonly AgentInterruptResponse[],
  fake: FakeAgentSession<TTools, TState>,
  options?: AgentResumeOptions<TState>
) => CompleteOutcome | void | PromiseLike<CompleteOutcome | void>;

/**
 * Runs for `runWithoutMessage`, `regenerate` and `retry` after the fake has made its own
 * change to the snapshot. Return the outcome the command resolves with;
 * nothing means `'success'`. Throwing rejects the command with that error.
 */
export type FakeCommandHandler<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >,
  TState = unknown
> = (
  fake: FakeAgentSession<TTools, TState>
) => CompleteOutcome | void | PromiseLike<CompleteOutcome | void>;

/** One recorded call to `session.submit`. */
export interface FakeSubmitCall<TState = unknown> {
  readonly input: AgentSubmitInput<TState>;
  readonly options?: AgentSubmitOptions;
}

/**
 * Runs after the fake appends the user message for a submission and merges any
 * state it carried. `input` is what the caller passed: the text, or an object
 * with `message` and `state`. Return the
 * outcome `submit` resolves with; nothing means `'success'`. Throwing rejects
 * `submit` with that error.
 */
export type FakeSubmitHandler<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >,
  TState = unknown
> = (
  input: AgentSubmitInput<TState>,
  fake: FakeAgentSession<TTools, TState>,
  options?: AgentSubmitOptions
) => CompleteOutcome | void | PromiseLike<CompleteOutcome | void>;

/** Initial snapshot fields, an optional state declaration and an optional submit handler. */
export interface FakeAgentSessionInit<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >,
  TState = unknown
> extends FakeAgentSnapshotPatch<TTools, TState> {
  /**
   * Types `state`, the way a real session's `stateType` does: `type<T>()` for
   * the type alone, or a Standard Schema to also check every state a test sets.
   */
  readonly stateType?: StateDeclaration<TState>;
  readonly onSubmit?: FakeSubmitHandler<TTools, TState>;
  readonly onResume?: FakeResumeHandler<TTools, TState>;
  /** Optional session members to carry; see {@link FakeCommand}. */
  readonly commands?: readonly FakeCommand[];
  /** Makes `runWithoutMessage` present and runs after it merges the state it was given. */
  readonly onRunWithoutMessage?: FakeCommandHandler<TTools, TState>;
  /** Makes `regenerate` present and runs after it removes the old answer. */
  readonly onRegenerate?: FakeCommandHandler<TTools, TState>;
  /**
   * Makes `retry` present and runs in place of the failed call. Without it,
   * `retry` calls the handler of the submission, resume, run or regeneration
   * that last failed again, with the same arguments.
   */
  readonly onRetry?: FakeCommandHandler<TTools, TState>;
  /** Makes `checkStatus` present and runs when it is called. */
  readonly onCheckStatus?: (
    fake: FakeAgentSession<TTools, TState>
  ) => void | PromiseLike<void>;
}

/** An assistant message that receives text until it completes. */
export interface FakeAssistantStream {
  readonly id: string;
  /** Appends text to the message content and publishes a new snapshot. */
  append(text: string): void;
  /**
   * Appends reasoning text. The time from the first reasoning text to the
   * first content text, or to completion, becomes `reasoningDurationMs`.
   */
  appendReasoning(text: string): void;
  /** Marks the message complete and returns the session to `'idle'`, or to
   * `'error'` when the session holds an error. Later calls are ignored. */
  complete(outcome?: CompleteOutcome): void;
}

/** A fake session and the controls a test uses to drive it. */
export interface FakeAgentSession<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >,
  TState = unknown
> {
  /** Pass this to `Chat`, `useAgent`, or any other session consumer. */
  readonly session: AgentSession<TTools, TState>;
  /** Submissions in call order, including ones the handler rejected. */
  readonly submits: readonly FakeSubmitCall<TState>[];
  /** Resumes in call order, including ones the fake or the handler rejected. */
  readonly resumes: readonly FakeResumeCall<TState>[];
  /** Calls to `runWithoutMessage` in order. */
  readonly runs: readonly FakeRunCall<TState>[];
  /** Calls to `regenerate` in order, including rejected ones. */
  readonly regenerates: readonly FakeRegenerateCall[];
  readonly retryCount: number;
  readonly checkStatusCount: number;
  /** Every catalog given to `clientTools.setCatalog`, in order; the last is current. */
  readonly catalogs: readonly (readonly ClientToolSpec[])[];
  /** Results given through `clientTools.settle` and `clientTools.resolve`, in order. */
  readonly clientToolResults: readonly FakeClientToolSettlement[];
  readonly flushCount: number;
  readonly stopCount: number;
  readonly disposed: boolean;
  /** Replaces the listed snapshot fields and notifies subscribers once. */
  set(patch: FakeAgentSnapshotPatch<TTools, TState>): void;
  /** Appends one message and returns the owned, frozen copy. */
  push(message: FakeMessageInput): Message;
  setStatus(status: AgentStatus): void;
  /** Publishes the error with status `'error'`; `undefined` clears it and
   * returns an errored session to `'idle'`. `cause` is any thrown value: the
   * fake describes it as the snapshot's `errorDiagnostic`. Replacing or
   * clearing the error removes the earlier diagnostic. */
  setError(error: AgentError | undefined, cause?: unknown): void;
  setToolCalls(toolCalls: readonly ToolCall<TTools>[]): void;
  /** Replaces the state; `undefined` removes it. Throws when a schema `stateType` rejects it. */
  setState(state: NoInfer<TState> | undefined): void;
  /** Replaces the pending interrupts; `undefined` removes the field. */
  setInterrupts(interrupts: readonly AgentInterrupt[] | undefined): void;
  /** Replaces the child agents; `undefined` removes the field. */
  setSubagents(subagents: readonly FakeSubagentInput[] | undefined): void;
  /** Replaces the reported usage; `undefined` removes the field. */
  setUsage(usage: AgentUsage | undefined): void;
  /**
   * Replaces the loaded history and, when given, the message-to-checkpoint
   * map; `undefined` removes both.
   */
  setCheckpoints(
    checkpoints: readonly AgentCheckpoint[] | undefined,
    messageCheckpoints?: Readonly<Record<string, string>>
  ): void;
  /**
   * Delivers one custom event to `onCustomEvent` listeners. A listener that
   * throws affects neither the others nor the caller. Nothing is delivered
   * after disposal.
   */
  emitCustomEvent(name: string, data?: PlainValue): void;
  /** Starts a streaming assistant message and sets status `'running'`. */
  stream(options?: {
    readonly id?: string;
    readonly text?: string;
  }): FakeAssistantStream;
  /** Replaces the handler used by later submissions. */
  onSubmit(handler: FakeSubmitHandler<TTools, TState> | undefined): void;
  /** Replaces the handler used by later resumes. */
  onResume(handler: FakeResumeHandler<TTools, TState> | undefined): void;
}

const plainFields = [
  'usage',
  'streamingToolCalls',
  'pendingClientTools',
  'checkpoints',
  'messageCheckpoints',
  'inputBlocked',
] as const;

const owned = new WeakSet<object>();

function own<T>(value: T, ancestors = new Set<object>()): T {
  if (value === null || typeof value !== 'object') return value;
  if (owned.has(value)) return value;
  if (ancestors.has(value))
    throw new TypeError('Fake snapshots require acyclic plain data.');
  ancestors.add(value);
  const copy = Array.isArray(value)
    ? value.map((item) => own(item, ancestors))
    : Object.fromEntries(
        Object.entries(value).flatMap(([key, item]) =>
          item === undefined ? [] : [[key, own(item, ancestors)]]
        )
      );
  ancestors.delete(value);
  owned.add(copy);
  return Object.freeze(copy) as T;
}

/**
 * Creates an in-memory {@link AgentSession} for tests and stories. There is no
 * transport: the test publishes snapshots through the returned controls, and
 * every snapshot is frozen and keeps unchanged messages by reference.
 * Subscribers are notified synchronously, so React tests wrap control calls in
 * `act`.
 *
 * By default `submit` records the call, appends a user message, merges any
 * submitted state into the snapshot's state, and resolves `'success'`. Pass
 * `onSubmit` to stream a reply or return another outcome.
 *
 * `resume` records the call, removes the interrupts it answers and resolves
 * `'success'`, or `'paused'` while others remain. It rejects a response that
 * names an interrupt the snapshot does not list, or names one twice. A message
 * or state passed in its options is applied the way `submit` applies them.
 *
 * `runWithoutMessage`, `regenerate`, `retry`, `checkStatus`, `onCustomEvent` and
 * `clientTools` are optional in the contract and absent here by default, so a
 * view under test offers no control for them. List one in `commands`, or pass
 * its handler, to make it present:
 *
 * - `runWithoutMessage` merges the state it is given and appends no message.
 * - `regenerate` removes the named assistant message and everything after it.
 *   It rejects during a run and for an id that names no assistant message.
 * - `retry` resolves `'aborted'` during a run or when the snapshot holds no
 *   error, rejects for an error that cannot be retried, and otherwise clears
 *   the error and calls again whichever handler last rejected.
 * - `checkStatus` counts the call and rejects during a run.
 * - `onCustomEvent` receives what `emitCustomEvent` sends.
 * - `clientTools` records catalogs and results. A result moves its call out of
 *   `pendingClientTools` and completes or fails the matching tool call.
 *
 * @example
 * ```ts
 * const fake = createFakeAgentSession({
 *   onSubmit: (input, fake) => {
 *     const reply = fake.stream();
 *     reply.append(`You said: ${input}`);
 *     reply.complete();
 *   },
 * });
 * render(<Chat session={fake.session} />);
 * ```
 */
export function createFakeAgentSession<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >,
  TState = unknown
>(
  init: FakeAgentSessionInit<TTools, TState> = {}
): FakeAgentSession<TTools, TState> {
  type Snapshot = {
    readonly status: AgentStatus;
    readonly messages: readonly Message[];
    readonly toolCalls: readonly ToolCall<TTools>[];
    readonly error?: AgentError;
    readonly plan?: readonly AgentPlanStep[];
    readonly state?: DeepReadonly<TState>;
    readonly interrupts?: readonly AgentInterrupt[];
    readonly subagents?: readonly AgentSubagent[];
    readonly errorDiagnostic?: AgentErrorDiagnostic;
    readonly usage?: AgentUsage;
    readonly streamingToolCalls?: readonly StreamingToolCall[];
    readonly pendingClientTools?: readonly ToolCall<TTools>[];
    readonly checkpoints?: readonly AgentCheckpoint[];
    readonly messageCheckpoints?: Readonly<Record<string, string>>;
    readonly inputBlocked?: AgentInputBlock;
  };
  const checkState = (value: unknown): DeepReadonly<TState> => {
    const reading = readState(init.stateType as StateDeclaration, value);
    if (!reading.valid)
      throw new TypeError(
        `The fake state does not match its schema: ${reading.issues.join('; ')}`
      );
    return own(reading.value) as DeepReadonly<TState>;
  };
  let sequence = 0;
  const nextId = (prefix: string) => `fake-${prefix}-${++sequence}`;
  const ownMessage = (input: FakeMessageInput): Message => {
    if (owned.has(input)) return input as Message;
    const id = input.id ?? nextId(input.role);
    return own({
      ...input,
      id,
      delivery: input.delivery ?? staticDelivery(id),
    });
  };
  const ownSubagent = (input: FakeSubagentInput): AgentSubagent => {
    if (owned.has(input)) return input as AgentSubagent;
    return own({
      ...input,
      status: input.status ?? 'complete',
      messages: (input.messages ?? []).map(ownMessage),
      toolCalls: input.toolCalls ?? [],
    });
  };
  const build = (
    base: Snapshot | undefined,
    patch: FakeAgentSnapshotPatch<TTools, TState>
  ): Snapshot => {
    const next: { -readonly [K in keyof Snapshot]: Snapshot[K] } = {
      status: patch.status ?? base?.status ?? 'idle',
      messages: patch.messages
        ? own(patch.messages.map(ownMessage))
        : base?.messages ?? own([]),
      toolCalls: patch.toolCalls
        ? own(patch.toolCalls)
        : base?.toolCalls ?? own([]),
    };
    const error =
      'error' in patch
        ? patch.error && projectAgentError(patch.error)
        : base?.error;
    if (error) next.error = error;
    const errorDiagnostic =
      'errorDiagnostic' in patch
        ? patch.errorDiagnostic
        : 'error' in patch
        ? undefined
        : base?.errorDiagnostic;
    if (error && errorDiagnostic !== undefined)
      next.errorDiagnostic = projectErrorDiagnostic(errorDiagnostic);
    const plan = 'plan' in patch ? patch.plan : base?.plan;
    if (plan) next.plan = own(plan);
    const state =
      'state' in patch
        ? patch.state === undefined
          ? undefined
          : checkState(patch.state)
        : base?.state;
    if (state !== undefined) next.state = state;
    const interrupts =
      'interrupts' in patch ? patch.interrupts : base?.interrupts;
    if (interrupts) next.interrupts = own(interrupts);
    const subagents =
      'subagents' in patch
        ? patch.subagents && own(patch.subagents.map(ownSubagent))
        : base?.subagents;
    if (subagents) next.subagents = subagents;
    const copy = <K extends (typeof plainFields)[number]>(key: K) => {
      const value = key in patch ? patch[key] : base?.[key];
      if (value) next[key] = own(value) as Snapshot[K];
    };
    plainFields.forEach(copy);
    return Object.freeze(next);
  };

  let snapshot = build(undefined, init);
  let handler = init.onSubmit;
  const listeners = new Set<() => void>();
  let resumeHandler = init.onResume;
  const submits: FakeSubmitCall<TState>[] = [];
  const resumes: FakeResumeCall<TState>[] = [];
  const runs: FakeRunCall<TState>[] = [];
  const regenerates: FakeRegenerateCall[] = [];
  const catalogs: (readonly ClientToolSpec[])[] = [];
  const clientToolResults: FakeClientToolSettlement[] = [];
  const eventListeners = new Set<(event: AgentSessionCustomEvent) => void>();
  const streams = new Set<() => void>();
  let stopCount = 0;
  let retryCount = 0;
  let checkStatusCount = 0;
  let flushCount = 0;
  let disposed = false;
  // The handler call that last rejected, kept so `retry` can make it again.
  type Operation = () => Promise<CompleteOutcome>;
  let failed: Operation | undefined;
  const attempt = async (operation: Operation): Promise<CompleteOutcome> => {
    try {
      const outcome = await operation();
      failed = undefined;
      return outcome;
    } catch (error) {
      failed = operation;
      throw error;
    }
  };
  const has = (command: FakeCommand, handler?: unknown): true | undefined =>
    init.commands?.includes(command) || handler !== undefined
      ? true
      : undefined;
  const alive = () => {
    if (disposed) throw new Error('The fake agent session is disposed.');
  };
  const merged = (update: object | undefined) =>
    update === undefined
      ? {}
      : {
          state: {
            ...(snapshot.state as object | undefined),
            ...update,
          } as NoInfer<TState>,
        };

  const publish = (patch: FakeAgentSnapshotPatch<TTools, TState>) => {
    snapshot = build(snapshot, patch);
    for (const notify of [...listeners]) notify();
  };
  const replaceMessage = (id: string, change: (message: Message) => Message) =>
    publish({
      messages: snapshot.messages.map((message) =>
        message.id === id ? change(message) : message
      ),
    });

  const settleClientTool = (
    kind: FakeClientToolSettlement['kind'],
    toolCallId: string,
    result: ClientToolResult
  ) => {
    alive();
    const pending = snapshot.pendingClientTools ?? [];
    if (!pending.some((call) => call.id === toolCallId))
      throw new TypeError(
        `No pending client tool call has the id "${toolCallId}".`
      );
    clientToolResults.push(own({ kind, toolCallId, result }));
    const settled = (call: ToolCall<TTools>) =>
      (call.id !== toolCallId
        ? call
        : result.ok
        ? {
            id: call.id,
            name: call.name,
            args: call.args,
            status: 'complete',
            result: result.value,
          }
        : {
            id: call.id,
            name: call.name,
            args: call.args,
            status: 'error',
            error: result.error,
          }) as ToolCall<TTools>;
    publish({
      toolCalls: snapshot.toolCalls.map(settled),
      pendingClientTools: pending.filter((call) => call.id !== toolCallId),
    });
  };

  const session = {
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      if (disposed) return () => undefined;
      const listener = () => notify();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async submit(
      input: AgentSubmitInput<TState>,
      options?: AgentSubmitOptions
    ): Promise<CompleteOutcome> {
      submits.push(Object.freeze(options ? { input, options } : { input }));
      alive();
      const update: AgentStateUpdate<TState> | undefined =
        typeof input === 'string' ? undefined : input.state;
      const blocks = typeof input === 'string' ? undefined : input.blocks;
      publish({
        messages: [
          ...snapshot.messages,
          ownMessage({
            role: 'user',
            content: typeof input === 'string' ? input : input.message,
            ...(blocks && { blocks }),
          }),
        ],
        ...merged(update as object | undefined),
      });
      return attempt(
        async () => (await handler?.(input, fake, options)) ?? 'success'
      );
    },
    ...(has('runWithoutMessage', init.onRunWithoutMessage) && {
      async runWithoutMessage(
        input?: { readonly state?: AgentStateUpdate<TState> },
        options?: AgentSubmitOptions
      ): Promise<CompleteOutcome> {
        runs.push(
          Object.freeze({
            ...(input && { input }),
            ...(options && { options }),
          })
        );
        alive();
        if (input?.state !== undefined) publish(merged(input.state as object));
        return attempt(
          async () => (await init.onRunWithoutMessage?.(fake)) ?? 'success'
        );
      },
    }),
    ...(has('regenerate', init.onRegenerate) && {
      async regenerate(
        messageId: string,
        options?: AgentSubmitOptions
      ): Promise<CompleteOutcome> {
        regenerates.push(
          Object.freeze(options ? { messageId, options } : { messageId })
        );
        alive();
        if (snapshot.status === 'running')
          throw new Error('A message cannot be regenerated during a run.');
        const index = snapshot.messages.findIndex(
          (message) => message.id === messageId
        );
        if (index < 0 || snapshot.messages[index].role !== 'assistant')
          throw new TypeError(
            `No assistant message has the id "${messageId}".`
          );
        publish({ messages: snapshot.messages.slice(0, index) });
        return attempt(
          async () => (await init.onRegenerate?.(fake)) ?? 'success'
        );
      },
    }),
    ...(has('retry', init.onRetry) && {
      async retry(): Promise<CompleteOutcome> {
        retryCount++;
        alive();
        const { error } = snapshot;
        if (snapshot.status === 'running' || !error) return 'aborted';
        if (
          error.recovery === undefined
            ? !error.retryable
            : error.recovery !== 'retry'
        )
          throw new Error('This failure cannot be retried.');
        publish({ error: undefined, status: 'idle' });
        const operation = failed;
        return attempt(
          init.onRetry
            ? async () => (await init.onRetry?.(fake)) ?? 'success'
            : operation ?? (async () => 'success')
        );
      },
    }),
    ...(has('checkStatus', init.onCheckStatus) && {
      async checkStatus(): Promise<void> {
        checkStatusCount++;
        alive();
        if (snapshot.status === 'running')
          throw new Error('The status cannot be checked during a run.');
        await init.onCheckStatus?.(fake);
      },
    }),
    ...(has('onCustomEvent') && {
      onCustomEvent(listener: (event: AgentSessionCustomEvent) => void) {
        if (disposed) return () => undefined;
        const entry = (event: AgentSessionCustomEvent) => listener(event);
        eventListeners.add(entry);
        return () => {
          eventListeners.delete(entry);
        };
      },
    }),
    ...(has('clientTools') && {
      clientTools: Object.freeze({
        setCatalog(specs: readonly ClientToolSpec[]) {
          alive();
          catalogs.push(own([...specs]));
        },
        settle: (toolCallId: string, result: ClientToolResult) =>
          settleClientTool('settle', toolCallId, result),
        async flush() {
          flushCount++;
          alive();
        },
        resolve: (toolCallId: string, result: ClientToolResult) =>
          settleClientTool('resolve', toolCallId, result),
      }),
    }),
    async resume(
      responses: readonly AgentInterruptResponse[],
      options?: AgentResumeOptions<TState>
    ): Promise<CompleteOutcome> {
      const answers = own([...responses]);
      resumes.push(
        Object.freeze(
          options ? { responses: answers, options } : { responses: answers }
        )
      );
      alive();
      const pending = snapshot.interrupts ?? [];
      const answered = new Set<string>();
      for (const { interruptId } of answers) {
        if (!pending.some((interrupt) => interrupt.id === interruptId))
          throw new TypeError(
            `No pending interrupt has the id "${interruptId}".`
          );
        if (answered.has(interruptId))
          throw new TypeError(
            `The interrupt "${interruptId}" is answered twice.`
          );
        answered.add(interruptId);
      }
      const remaining = pending.filter(
        (interrupt) => !answered.has(interrupt.id)
      );
      const sent = options?.message !== undefined || options?.blocks;
      if (answered.size > 0 || sent || options?.state !== undefined)
        publish({
          ...(answered.size > 0 && { interrupts: remaining }),
          ...(sent && {
            messages: [
              ...snapshot.messages,
              ownMessage({
                role: 'user',
                content: options.message ?? '',
                ...(options.blocks && { blocks: options.blocks }),
              }),
            ],
          }),
          ...merged(options?.state as object | undefined),
        });
      return attempt(
        async () =>
          (await resumeHandler?.(answers, fake, options)) ??
          (remaining.length > 0 ? 'paused' : 'success')
      );
    },
    async stop() {
      stopCount++;
      for (const abort of [...streams]) abort();
      if (snapshot.status === 'running') publish({ status: 'idle' });
    },
    async dispose() {
      disposed = true;
      listeners.clear();
      eventListeners.clear();
    },
  };

  const fake: FakeAgentSession<TTools, TState> = {
    session: session as unknown as AgentSession<TTools, TState>,
    submits,
    resumes,
    runs,
    regenerates,
    catalogs,
    clientToolResults,
    get retryCount() {
      return retryCount;
    },
    get checkStatusCount() {
      return checkStatusCount;
    },
    get flushCount() {
      return flushCount;
    },
    get stopCount() {
      return stopCount;
    },
    get disposed() {
      return disposed;
    },
    set: publish,
    push(message) {
      const next = ownMessage(message);
      publish({ messages: [...snapshot.messages, next] });
      return next;
    },
    setStatus: (status) => publish({ status }),
    setError: (error, cause) =>
      publish(
        error
          ? {
              error,
              status: 'error',
              ...(cause !== undefined && {
                errorDiagnostic: projectErrorDiagnostic(cause),
              }),
            }
          : {
              error: undefined,
              status: snapshot.status === 'error' ? 'idle' : snapshot.status,
            }
      ),
    setToolCalls: (toolCalls) => publish({ toolCalls }),
    setState: (state) => publish({ state }),
    setInterrupts: (interrupts) => publish({ interrupts }),
    setSubagents: (subagents) => publish({ subagents }),
    setUsage: (usage) => publish({ usage }),
    setCheckpoints: (checkpoints, messageCheckpoints) =>
      publish({
        checkpoints,
        ...((messageCheckpoints || !checkpoints) && { messageCheckpoints }),
      }),
    emitCustomEvent(name, data) {
      if (disposed) return;
      const event = own({ name, data }) as AgentSessionCustomEvent;
      for (const listener of [...eventListeners]) {
        try {
          listener(event);
        } catch {
          // A listener's failure belongs to the listener.
        }
      }
    },
    stream(options = {}) {
      const id = options.id ?? nextId('assistant');
      let open = true;
      let reasoningStartedAt: number | undefined;
      // Closes the reasoning phase once, measuring it from its first text.
      const timed = (message: Message): Message => {
        if (reasoningStartedAt === undefined) return message;
        const reasoningDurationMs = Date.now() - reasoningStartedAt;
        reasoningStartedAt = undefined;
        return { ...message, reasoningDurationMs };
      };
      const finish = (outcome: CompleteOutcome) => {
        if (!open) return;
        open = false;
        streams.delete(abort);
        replaceMessage(id, (message) =>
          ownMessage({
            ...timed(message),
            delivery: completeDelivery(id, outcome),
          })
        );
        if (snapshot.status === 'running' && streams.size === 0)
          publish({ status: snapshot.error ? 'error' : 'idle' });
      };
      const abort = () => finish('aborted');
      streams.add(abort);
      publish({
        status: 'running',
        messages: [
          ...snapshot.messages,
          ownMessage({
            id,
            role: 'assistant',
            content: options.text ?? '',
            delivery: streamingDelivery(id),
          }),
        ],
      });
      return {
        id,
        append(text) {
          if (!open) return;
          replaceMessage(id, (message) =>
            ownMessage({
              ...timed(message),
              content: message.content + text,
            })
          );
        },
        appendReasoning(text) {
          if (!open) return;
          const first = snapshot.messages.find((message) => message.id === id);
          if (first?.reasoning === undefined && first?.content === '')
            reasoningStartedAt = Date.now();
          replaceMessage(id, (message) =>
            ownMessage({
              ...message,
              reasoning: (message.reasoning ?? '') + text,
            })
          );
        },
        complete: (outcome = 'success') => finish(outcome),
      };
    },
    onSubmit(next) {
      handler = next;
    },
    onResume(next) {
      resumeHandler = next;
    },
  };
  return fake;
}
