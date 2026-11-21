import type {
  AgentSession,
  AgentSubmitInput,
  AgentSubmitOptions,
} from '../contracts/agent-session.js';
import type { AgentStatus } from '../contracts/agent-snapshot.js';
import {
  completeDelivery,
  staticDelivery,
  streamingDelivery,
  type CompleteOutcome,
  type MessageDelivery,
} from '../contracts/delivery.js';
import { projectAgentError, type AgentError } from '../contracts/error.js';
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
 * explicit `undefined` for `error`, `plan`, `state`, `interrupts` or
 * `subagents` removes the field. `state` replaces the whole state and is checked against the
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
}

/** One recorded call to `session.resume`. */
export interface FakeResumeCall {
  readonly responses: readonly AgentInterruptResponse[];
  readonly options?: AgentSubmitOptions;
}

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
  options?: AgentSubmitOptions
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
}

/** An assistant message that receives text until it completes. */
export interface FakeAssistantStream {
  readonly id: string;
  /** Appends text to the message content and publishes a new snapshot. */
  append(text: string): void;
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
  readonly resumes: readonly FakeResumeCall[];
  readonly stopCount: number;
  readonly disposed: boolean;
  /** Replaces the listed snapshot fields and notifies subscribers once. */
  set(patch: FakeAgentSnapshotPatch<TTools, TState>): void;
  /** Appends one message and returns the owned, frozen copy. */
  push(message: FakeMessageInput): Message;
  setStatus(status: AgentStatus): void;
  /** Publishes the error with status `'error'`; `undefined` clears it and
   * returns an errored session to `'idle'`. */
  setError(error: AgentError | undefined): void;
  setToolCalls(toolCalls: readonly ToolCall<TTools>[]): void;
  /** Replaces the state; `undefined` removes it. Throws when a schema `stateType` rejects it. */
  setState(state: NoInfer<TState> | undefined): void;
  /** Replaces the pending interrupts; `undefined` removes the field. */
  setInterrupts(interrupts: readonly AgentInterrupt[] | undefined): void;
  /** Replaces the child agents; `undefined` removes the field. */
  setSubagents(subagents: readonly FakeSubagentInput[] | undefined): void;
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
 * names an interrupt the snapshot does not list, or names one twice.
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
    const next: {
      status: AgentStatus;
      messages: readonly Message[];
      toolCalls: readonly ToolCall<TTools>[];
      error?: AgentError;
      plan?: readonly AgentPlanStep[];
      state?: DeepReadonly<TState>;
      interrupts?: readonly AgentInterrupt[];
      subagents?: readonly AgentSubagent[];
    } = {
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
    return Object.freeze(next);
  };

  let snapshot = build(undefined, init);
  let handler = init.onSubmit;
  const listeners = new Set<() => void>();
  let resumeHandler = init.onResume;
  const submits: FakeSubmitCall<TState>[] = [];
  const resumes: FakeResumeCall[] = [];
  const streams = new Set<() => void>();
  let stopCount = 0;
  let disposed = false;

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
      if (disposed) throw new Error('The fake agent session is disposed.');
      const update: AgentStateUpdate<TState> | undefined =
        typeof input === 'string' ? undefined : input.state;
      publish({
        messages: [
          ...snapshot.messages,
          ownMessage({
            role: 'user',
            content: typeof input === 'string' ? input : input.message,
          }),
        ],
        ...(update !== undefined && {
          state: {
            ...(snapshot.state as object | undefined),
            ...(update as object),
          } as NoInfer<TState>,
        }),
      });
      const outcome = await handler?.(input, fake, options);
      return outcome ?? 'success';
    },
    async resume(
      responses: readonly AgentInterruptResponse[],
      options?: AgentSubmitOptions
    ): Promise<CompleteOutcome> {
      const answers = own([...responses]);
      resumes.push(
        Object.freeze(
          options ? { responses: answers, options } : { responses: answers }
        )
      );
      if (disposed) throw new Error('The fake agent session is disposed.');
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
      if (answered.size > 0) publish({ interrupts: remaining });
      const outcome = await resumeHandler?.(answers, fake, options);
      return outcome ?? (remaining.length > 0 ? 'paused' : 'success');
    },
    async stop() {
      stopCount++;
      for (const abort of [...streams]) abort();
      if (snapshot.status === 'running') publish({ status: 'idle' });
    },
    async dispose() {
      disposed = true;
      listeners.clear();
    },
  };

  const fake: FakeAgentSession<TTools, TState> = {
    session: session as unknown as AgentSession<TTools, TState>,
    submits,
    resumes,
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
    setError: (error) =>
      publish(
        error
          ? { error, status: 'error' }
          : {
              error: undefined,
              status: snapshot.status === 'error' ? 'idle' : snapshot.status,
            }
      ),
    setToolCalls: (toolCalls) => publish({ toolCalls }),
    setState: (state) => publish({ state }),
    setInterrupts: (interrupts) => publish({ interrupts }),
    setSubagents: (subagents) => publish({ subagents }),
    stream(options = {}) {
      const id = options.id ?? nextId('assistant');
      let open = true;
      const finish = (outcome: CompleteOutcome) => {
        if (!open) return;
        open = false;
        streams.delete(abort);
        replaceMessage(id, (message) =>
          ownMessage({ ...message, delivery: completeDelivery(id, outcome) })
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
            ownMessage({ ...message, content: message.content + text })
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
