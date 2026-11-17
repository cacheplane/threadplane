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
import type { AgentPlanStep } from '../contracts/plan.js';
import type { ToolCall, ToolContract } from '../contracts/tool.js';

/** A message to place in a fake snapshot. The id defaults to a generated one
 * and the delivery to a complete, successful static delivery. */
export type FakeMessageInput = Omit<Message, 'id' | 'delivery'> & {
  readonly id?: string;
  readonly delivery?: MessageDelivery;
};

/** Snapshot fields a test may replace. Omitted fields keep their value; an
 * explicit `error: undefined` or `plan: undefined` removes the field. */
export interface FakeAgentSnapshotPatch<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >
> {
  readonly status?: AgentStatus;
  readonly messages?: readonly FakeMessageInput[];
  readonly toolCalls?: readonly ToolCall<TTools>[];
  readonly error?: AgentError;
  readonly plan?: readonly AgentPlanStep[];
}

/** One recorded call to `session.submit`. */
export interface FakeSubmitCall {
  readonly input: AgentSubmitInput;
  readonly options?: AgentSubmitOptions;
}

/**
 * Runs after the fake appends the user message for a submission. Return the
 * outcome `submit` resolves with; nothing means `'success'`. Throwing rejects
 * `submit` with that error.
 */
export type FakeSubmitHandler<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >
> = (
  input: AgentSubmitInput,
  fake: FakeAgentSession<TTools>,
  options?: AgentSubmitOptions
) => CompleteOutcome | void | PromiseLike<CompleteOutcome | void>;

/** Initial snapshot fields plus an optional submit handler. */
export interface FakeAgentSessionInit<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >
> extends FakeAgentSnapshotPatch<TTools> {
  readonly onSubmit?: FakeSubmitHandler<TTools>;
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
  >
> {
  /** Pass this to `Chat`, `useAgent`, or any other session consumer. */
  readonly session: AgentSession<TTools>;
  /** Submissions in call order, including ones the handler rejected. */
  readonly submits: readonly FakeSubmitCall[];
  readonly stopCount: number;
  readonly disposed: boolean;
  /** Replaces the listed snapshot fields and notifies subscribers once. */
  set(patch: FakeAgentSnapshotPatch<TTools>): void;
  /** Appends one message and returns the owned, frozen copy. */
  push(message: FakeMessageInput): Message;
  setStatus(status: AgentStatus): void;
  /** Publishes the error with status `'error'`; `undefined` clears it and
   * returns an errored session to `'idle'`. */
  setError(error: AgentError | undefined): void;
  setToolCalls(toolCalls: readonly ToolCall<TTools>[]): void;
  /** Starts a streaming assistant message and sets status `'running'`. */
  stream(options?: {
    readonly id?: string;
    readonly text?: string;
  }): FakeAssistantStream;
  /** Replaces the handler used by later submissions. */
  onSubmit(handler: FakeSubmitHandler<TTools> | undefined): void;
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
 * By default `submit` records the call, appends a user message, and resolves
 * `'success'`. Pass `onSubmit` to stream a reply or return another outcome.
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
  >
>(init: FakeAgentSessionInit<TTools> = {}): FakeAgentSession<TTools> {
  type Snapshot = {
    readonly status: AgentStatus;
    readonly messages: readonly Message[];
    readonly toolCalls: readonly ToolCall<TTools>[];
    readonly error?: AgentError;
    readonly plan?: readonly AgentPlanStep[];
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
  const build = (
    base: Snapshot | undefined,
    patch: FakeAgentSnapshotPatch<TTools>
  ): Snapshot => {
    const next: {
      status: AgentStatus;
      messages: readonly Message[];
      toolCalls: readonly ToolCall<TTools>[];
      error?: AgentError;
      plan?: readonly AgentPlanStep[];
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
    return Object.freeze(next);
  };

  let snapshot = build(undefined, init);
  let handler = init.onSubmit;
  const listeners = new Set<() => void>();
  const submits: FakeSubmitCall[] = [];
  const streams = new Set<() => void>();
  let stopCount = 0;
  let disposed = false;

  const publish = (patch: FakeAgentSnapshotPatch<TTools>) => {
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
      input: AgentSubmitInput,
      options?: AgentSubmitOptions
    ): Promise<CompleteOutcome> {
      submits.push(Object.freeze(options ? { input, options } : { input }));
      if (disposed) throw new Error('The fake agent session is disposed.');
      fake.push({ role: 'user', content: input });
      const outcome = await handler?.(input, fake, options);
      return outcome ?? 'success';
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

  const fake: FakeAgentSession<TTools> = {
    session: session as unknown as AgentSession<TTools>,
    submits,
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
  };
  return fake;
}
