import { signal, type Provider, type Signal } from '@angular/core';
import type {
  AgentSession,
  AgentSubmitOptions,
  CompleteOutcome,
  ToolContract,
} from '@threadplane/core';
import {
  createFakeAgentSession,
  type FakeAgentSession,
  type FakeAgentSessionInit,
} from '@threadplane/core/testing';
import {
  injectAgent,
  provideAgent,
  ɵagentConfig,
  ɵisAgentRef,
  type AgentConfig,
  type AgentRef,
  type AgentSessionContext,
} from '@threadplane/angular';

/** Configuration for {@link provideFakeAgent}. */
export interface FakeAgentConfig<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >,
  TState = unknown
> {
  /** The assistant reply, streamed one entry at a time. */
  readonly tokens?: readonly string[];
  /** Reasoning text streamed before the reply. */
  readonly reasoningTokens?: readonly string[];
  /** Milliseconds between entries. Defaults to 60; 0 streams without timers. */
  readonly delayMs?: number;
  /** The thread to start on; a signal makes the agent follow it. */
  readonly threadId?: AgentConfig['threadId'];
  /** Called with the id the fake gives a new thread on its first submit. */
  readonly onThreadId?: (threadId: string) => void;
  /**
   * Initial snapshot fields and handlers for every fake session. An `onSubmit`
   * here replaces the canned reply. Initial `messages` seed a thread the fake
   * has not seen; a thread it has seen comes back with what it held.
   */
  readonly session?: FakeAgentSessionInit<TTools, TState>;
}

const DEFAULT_TOKENS: readonly string[] = [
  'Hello',
  ' from',
  ' the',
  ' fake',
  ' agent.',
];
const holders = new WeakMap<object, Signal<FakeAgentSession>>();
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function reply(
  fake: FakeAgentSession,
  config: FakeAgentConfig,
  options: AgentSubmitOptions | undefined
): Promise<CompleteOutcome> {
  const stops = fake.stopCount;
  const live = () =>
    !fake.disposed && fake.stopCount === stops && !options?.signal?.aborted;
  const pause = config.delayMs ?? 60;
  const stream = fake.stream();
  let reasoning = '';
  for (const chunk of config.reasoningTokens ?? []) {
    reasoning += chunk;
    fake.set({
      messages: fake.session
        .getSnapshot()
        .messages.map((message) =>
          message.id === stream.id ? { ...message, reasoning } : message
        ),
    });
    if (pause > 0) await delay(pause);
    if (!live()) break;
  }
  for (const token of config.tokens ?? DEFAULT_TOKENS) {
    if (!live()) break;
    stream.append(token);
    if (pause > 0) await delay(pause);
  }
  const outcome = live() ? 'success' : 'aborted';
  // Already closed when the session was stopped; needed for a caller's signal.
  stream.complete(outcome);
  return outcome;
}

function fakeConfig(config: FakeAgentConfig): AgentConfig<AgentSession> {
  const threads = new Map<string, FakeAgentSession>();
  const current = signal<FakeAgentSession | undefined>(undefined);
  let created = 0;
  // The fake binds synchronously, unlike an application's async factory, so a
  // test sees its session as soon as the agent exists. The agent adopts a
  // session returned as is; the public type asks for a Promise.
  const agentConfig = {
    ...(config.threadId !== undefined && { threadId: config.threadId }),
    ...(config.onThreadId && { onThreadId: config.onThreadId }),
    createSession({ threadId, onThreadId }: AgentSessionContext) {
      const init = (config.session ?? {}) as FakeAgentSessionInit;
      const seen = threadId === null ? undefined : threads.get(threadId);
      let id = threadId;
      const fake: FakeAgentSession = createFakeAgentSession({
        ...init,
        ...(seen && { messages: seen.session.getSnapshot().messages }),
        onSubmit: (input, self, options) => {
          if (id === null) {
            // As a backend does, the fake names its thread on first use.
            id = `fake-thread-${++created}`;
            threads.set(id, self);
            onThreadId(id);
          }
          return init.onSubmit
            ? init.onSubmit(input, self, options)
            : reply(self, config, options);
        },
      });
      if (id !== null) threads.set(id, fake);
      current.set(fake);
      return fake.session;
    },
  } as unknown as AgentConfig<AgentSession>;
  holders.set(agentConfig, current as Signal<FakeAgentSession>);
  return agentConfig;
}

/**
 * Provides an agent with no backend, for demos, stories and tests. It is the
 * agent `provideAgent` builds, over the in-memory session from
 * `@threadplane/core/testing`.
 *
 * Each submit appends the user's message and streams a canned assistant reply.
 * A new thread is given an id on its first submit, and a thread the fake has
 * seen comes back with its messages when the agent switches to it again.
 *
 * Drive it from a test through {@link injectFakeAgentSession}.
 *
 * @example
 * ```ts
 * TestBed.configureTestingModule({
 *   providers: [provideFakeAgent({ tokens: ['Hi', ' there'], delayMs: 0 })],
 * });
 * ```
 */
export function provideFakeAgent<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >,
  TState = unknown
>(
  ref: AgentRef<AgentSession<TTools, TState>>,
  config?: FakeAgentConfig<NoInfer<TTools>, NoInfer<TState>>
): Provider[];
export function provideFakeAgent<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >,
  TState = unknown
>(config?: FakeAgentConfig<TTools, TState>): Provider[];
export function provideFakeAgent(
  refOrConfig?: AgentRef<never> | FakeAgentConfig,
  maybeConfig?: FakeAgentConfig
): Provider[] {
  if (ɵisAgentRef(refOrConfig))
    return provideAgent(
      refOrConfig as unknown as AgentRef<AgentSession>,
      () => fakeConfig(maybeConfig ?? {})
    );
  return provideAgent(() => fakeConfig(refOrConfig ?? {}));
}

/**
 * The controls of the fake session behind the agent `provideFakeAgent`
 * provided: `push`, `stream`, `setError`, `submits` and the rest. It is a
 * signal because a thread switch gives the agent another fake session. Call it
 * in an injection context.
 */
export function injectFakeAgentSession<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >,
  TState = unknown
>(
  ref?: AgentRef<AgentSession<TTools, TState>>
): Signal<FakeAgentSession<TTools, TState>> {
  const agent = ref
    ? injectAgent(ref as unknown as AgentRef<AgentSession>)
    : injectAgent();
  const config = ɵagentConfig(agent);
  const holder = config && holders.get(config);
  if (!holder)
    throw new Error(
      'injectFakeAgentSession: the agent here was not provided by provideFakeAgent.'
    );
  return holder as unknown as Signal<FakeAgentSession<TTools, TState>>;
}
