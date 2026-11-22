import {
  DestroyRef,
  Injector,
  computed,
  effect,
  inject,
  isSignal,
  runInInjectionContext,
  signal,
  untracked,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import type { AgentSession, AgentSessionCustomEvent } from '@threadplane/core';
import { AgentLifecycleRegistry, type AgentLifecycle } from './agent-lifecycle';
import {
  AGENT_CLIENT_OPTIONS,
  ɵAGENT_DEVELOPMENT_RUNTIME_REGISTRAR,
  ɵAGENT_OPERATION_FAILURE_REPORTER,
  type AgentDevelopmentRuntimeRegistrar,
  type AgentOperationFailureReporter,
} from './agent-tokens';
import {
  ɵrelayDevelopmentRuntime,
  ɵwhenAgentDevelopmentHost,
  type AgentDevelopmentRuntimeFactory,
} from './development-host';

/** The least a session must offer for an {@link Agent} to stand in front of it. */
export interface AgentSessionLike {
  getSnapshot(): object;
  /** Changes only. The initial aggregate is read through `getSnapshot`. */
  subscribe(notify: () => void): () => void;
  dispose(): Promise<void>;
}

/** The snapshot type a session publishes. */
export type AgentSnapshotOf<TSession> = TSession extends {
  getSnapshot(): infer TSnapshot;
}
  ? TSnapshot
  : never;

/**
 * One read-only signal for each snapshot field. An optional field is a signal
 * of its value or `undefined`, so a template never has to ask whether the
 * signal itself exists.
 */
export type AgentFieldSignals<TSnapshot> = {
  readonly [K in keyof TSnapshot]-?: Signal<TSnapshot[K]>;
};

/** Session members the agent owns and therefore does not pass through. */
export type AgentSessionPlumbing = 'getSnapshot' | 'subscribe' | 'dispose';

/**
 * What an agent adds because it outlives any one session: the thread it is on,
 * a retained list of the current run's custom events, and its lifecycle.
 */
export interface AgentControls {
  /**
   * The thread the agent is on: the configured or switched-to id, or the id
   * the session reported when it created its thread. Null before a thread
   * exists.
   */
  readonly threadId: Signal<string | null>;
  /** True while the selected thread's saved history is being read. */
  readonly isThreadLoading: Signal<boolean>;
  /**
   * Moves the agent to another thread, or to a new empty one with `null`. The
   * session underneath is replaced: the old one is stopped and disposed and
   * can publish nothing further, and every signal carries on with the new
   * thread. Calling it with the current id reloads that thread.
   */
  switchThread(threadId: string | null): void;
  /**
   * How many times the session underneath has been replaced: 0 for the session
   * the agent was built with, one more after each thread switch. Read it in an
   * effect to redo what belongs to one session, such as handing it a client
   * tool catalog.
   */
  readonly sessionEpoch: Signal<number>;
  /**
   * Registers a listener that is called each time `stop()` is called on the
   * agent, before the session is told to stop. A library uses it to cancel
   * work of its own that a session cannot reach, such as a client tool handler
   * running in the browser. The registration outlives thread switches and ends
   * with the returned release or with the agent. A thread switch and the
   * agent's destruction stop the old session without calling the listeners.
   */
  onStop(listener: () => void): () => void;
  /**
   * The custom events the current run has emitted, oldest first. Empty again
   * when the next run starts and when the agent switches threads. Stays empty
   * on a session without `onCustomEvent`.
   */
  readonly customEvents: Signal<readonly AgentSessionCustomEvent[]>;
  /** Milestone timestamps; see {@link AgentLifecycle}. */
  readonly lifecycle: AgentLifecycle;
}

/**
 * The instance an Angular component injects: a session's snapshot fields as
 * signals, the session's commands with their own signatures, and the
 * {@link AgentControls}.
 *
 * The type is derived from the session, so a backend's extra snapshot fields
 * and commands appear without this layer naming them. Where a session member
 * and a snapshot field share a name, the session member is the one exposed.
 *
 * The object is stable for the life of its injector. Switching threads
 * replaces the session underneath; the signals and commands stay the same
 * references and follow the new session.
 */
export type Agent<TSession extends AgentSessionLike = AgentSession> =
  AgentControls &
    Omit<TSession, AgentSessionPlumbing | keyof AgentControls> &
    Omit<
      AgentFieldSignals<AgentSnapshotOf<TSession>>,
      keyof TSession | keyof AgentControls
    >;

/** What a session factory is given each time the agent needs a session. */
export interface AgentSessionContext {
  /** The thread the new session belongs to, or null for a new empty one. */
  readonly threadId: string | null;
  /**
   * Tells the agent the id of a thread the session created, or one the factory
   * chose because none was given. Pass it to the session as its `onThreadId`.
   * A report from a session the agent has already replaced is ignored.
   */
  readonly onThreadId: (threadId: string) => void;
  /**
   * The app-wide `AGENT_CLIENT_OPTIONS`, when provided. Typed `object` because
   * the shape belongs to the backend, which this package does not import. A
   * first-party `createSession` takes it as its `clientOptions` with no cast.
   */
  readonly clientOptions: object | undefined;
  /**
   * The host's operation failure reporter, when provided. The first-party
   * sessions take it as their `reportOperationFailure` option, so spreading
   * the context passes it on.
   */
  readonly reportOperationFailure: AgentOperationFailureReporter | undefined;
  /**
   * Builds the session's development-install collector. A first-party session
   * takes it as its `developmentRuntime` option and calls it with what its
   * package knows of its own installation. It is inert unless a host with the
   * collector is loaded (the chat package registers one), and outside a
   * development build in a browser.
   */
  readonly developmentRuntime: AgentDevelopmentRuntimeFactory;
}

/** Configuration for one injected agent. */
export interface AgentConfig<TSession extends AgentSessionLike = AgentSession> {
  /**
   * Creates the session for one thread, asynchronously, so the backend package
   * can load on demand: `(context) => import('@threadplane/langgraph').then((m)
   * => m.createSession({ ...options, ...context }))`. Called once when the agent
   * is built and again for each thread switch, always in the agent's injection
   * context, so it may call `inject()` before its first `await`. The agent owns
   * every session it is given and disposes it.
   *
   * Until the first session resolves, the agent shows an empty idle
   * conversation. During a thread switch it keeps the current thread, with
   * `isThreadLoading()` true for a thread with an id, until the new session
   * resolves; only the latest switch is adopted. Commands called meanwhile wait
   * for the new session and then run on it, except `stop`, which goes to the
   * current session at once. When the factory rejects, the agent keeps its
   * current session and the waiting commands reject with the same error.
   */
  readonly createSession: (context: AgentSessionContext) => Promise<TSession>;
  /**
   * The thread to start on. Pass a signal to have the agent follow it: a
   * change to a different id switches threads.
   */
  readonly threadId?: Signal<string | null | undefined> | string | null;
  /** Called with the id of a thread a session created. */
  readonly onThreadId?: (threadId: string) => void;
  /**
   * Names of optional commands, or other optional session members, this
   * backend's sessions may leave undefined, beyond the core contract's. A name
   * listed here reads as `undefined` on the agent while the session lacks it,
   * instead of as a snapshot field.
   */
  readonly optionalCommands?: readonly string[];
}

/**
 * The session members that the core contract or a first-party backend's
 * session type declares optional (`name?`): a session may leave each one out,
 * so a caller asks before using it. Kept equal to those types; the agent type
 * tests prove each name optional on at least one of them.
 */
const OPTIONAL_MEMBERS: readonly string[] = [
  // The core contract. The LangGraph session always has `onCustomEvent`,
  // `resume` and `runWithoutMessage`; the AG-UI session always has `resume`.
  'onCustomEvent',
  'runWithoutMessage',
  'regenerate',
  'resume',
  'clientTools',
  'checkStatus',
  'retry',
  // Both first-party backends.
  'load',
  // The AG-UI session only.
  'onRawEvent',
  'reconcileInterrupt',
  'ready',
  'agentId',
  'stateType',
];

/**
 * Commands one first-party backend's session always has, so they are not
 * optional on that backend's agent and need no `?.` there. A session of
 * another kind lacks them: the in-memory fake provided under a backend's ref,
 * a hand-written session, the other backend. There each reads as `undefined`,
 * as a missing command does, and never as a snapshot field.
 */
const BACKEND_COMMANDS: readonly string[] = [
  // Both first-party backends.
  'isDevelopmentRuntimeEnabled',
  // The LangGraph session.
  'fork',
  'reconnect',
  'joinStream',
  'setBranch',
  'cancelQueued',
  'clearQueue',
];

/**
 * Names tools probe on arbitrary objects. None can be a snapshot field, so a
 * probe is answered with `undefined` rather than with a signal.
 */
const NEVER_FIELDS = new Set([
  'then',
  'catch',
  'finally',
  'constructor',
  'prototype',
  'toJSON',
  'toString',
  'toLocaleString',
  'valueOf',
  'inspect',
  'asymmetricMatch',
  'nodeType',
  'nodeName',
  'tagName',
  'ngOnDestroy',
]);
const FIELD_NAME = /^[a-z][A-Za-z0-9]*$/;
/** The commands the core contract requires of every session. */
const REQUIRED_COMMANDS = new Set(['submit', 'stop']);
/**
 * What the agent shows before its first session is adopted: the core
 * contract's required fields, and the collections a first-party backend's
 * snapshot always holds (LangGraph's `interrupts`, `subgraphs` and
 * `subagents`; AG-UI's `subagents`), so a typed read of them is an empty list
 * rather than `undefined` while the session loads.
 */
const EMPTY_SNAPSHOT: object = Object.freeze({
  status: 'idle',
  messages: Object.freeze([]),
  toolCalls: Object.freeze([]),
  interrupts: Object.freeze([]),
  subgraphs: Object.freeze([]),
  subagents: Object.freeze([]),
});
const PLUMBING = new Set<string>(['getSnapshot', 'subscribe', 'dispose']);

const LIFECYCLE_KEYS = [
  'streamStartedAt',
  'streamErrorAt',
  'interruptReceivedAt',
  'interruptResolvedAt',
  'threadCreatedAt',
  'threadPersistedAt',
  'toolCallStartedAt',
  'toolCallCompletedAt',
] as const;

type Members = Record<string, unknown>;
const configs = new WeakMap<object, object>();

/** @internal The config an agent was created from. */
export function ɵagentConfig(agent: object): object | undefined {
  return configs.get(agent);
}

/** Per agent: registers another object for the agent's development policy. */
const policyRegistrations = new WeakMap<object, (target: object) => void>();

/**
 * @internal Makes `derived` stand for `source` wherever an agent is looked up
 * by identity: it resolves to the same config, and is registered for
 * development-install collection with the same registrar and policy. Does
 * nothing for a `source` that `createAgent` did not build.
 */
export function ɵadoptDerivedAgent(derived: object, source: object): void {
  const config = configs.get(source);
  if (config) configs.set(derived, config);
  const register = policyRegistrations.get(source);
  if (!register) return;
  policyRegistrations.set(derived, register);
  register(derived);
}
interface LifecycleSource {
  getSnapshot(): Members;
  subscribe(notify: () => void): () => void;
}
interface Binding {
  readonly threadId: string | null;
  session?: AgentSessionLike;
  /** An id the factory reported before the session was adopted. */
  reported?: string;
  readonly releases: (() => void)[];
}

/** Own or inherited, but never what every object inherits. */
function holds(target: object, key: string): boolean {
  return key in target && !(key in Object.prototype);
}

function settle(run: () => unknown): void {
  try {
    const result = run();
    if (result && typeof (result as PromiseLike<unknown>).then === 'function')
      (result as PromiseLike<unknown>).then(undefined, () => undefined);
  } catch {
    /* A session being replaced or destroyed cannot fail the agent. */
  }
}

function lifecycleSource(
  session: AgentSessionLike
): LifecycleSource | undefined {
  const source = (session as unknown as Members)['lifecycle'];
  return source &&
    typeof source === 'object' &&
    typeof (source as LifecycleSource).getSnapshot === 'function' &&
    typeof (source as LifecycleSource).subscribe === 'function'
    ? (source as LifecycleSource)
    : undefined;
}

/**
 * Builds the {@link Agent} for a session factory. Call it in an injection
 * context; `provideAgent` does. The agent creates its first session at once,
 * replaces it on each thread switch and disposes the last one when the
 * injection context is destroyed.
 *
 * When a thread is selected and the session offers `load`, its saved history
 * is read automatically and `isThreadLoading` is true meanwhile. A failed read
 * leaves the thread empty.
 *
 * The agent is registered once for development-install collection: with the
 * registrar the host provides, or else with the page's collector host when
 * one is loaded. Its policy asks the current session's
 * `isDevelopmentRuntimeEnabled()` each time, and is false for a session
 * without that member. Each session is handed `context.developmentRuntime`.
 */
export function createAgent<TSession extends AgentSessionLike>(
  config: AgentConfig<TSession>
): Agent<TSession> {
  const injector = inject(Injector);
  const destroyRef = inject(DestroyRef);
  const registry = inject(AgentLifecycleRegistry);
  const clientOptions =
    inject(AGENT_CLIENT_OPTIONS, { optional: true }) ?? undefined;
  const reportOperationFailure =
    inject(ɵAGENT_OPERATION_FAILURE_REPORTER, { optional: true }) ?? undefined;
  // A registrar given through DI wins. Otherwise the agent is registered with
  // the page's collector host, now or when one is loaded.
  const registerDevelopmentRuntime: AgentDevelopmentRuntimeRegistrar =
    inject(ɵAGENT_DEVELOPMENT_RUNTIME_REGISTRAR, { optional: true }) ??
    ((agent, policy) =>
      destroyRef.onDestroy(
        ɵwhenAgentDevelopmentHost((host) => host.registerPolicy(agent, policy))
      ));
  const optionalCommands = new Set([
    ...OPTIONAL_MEMBERS,
    ...BACKEND_COMMANDS,
    ...(config.optionalCommands ?? []),
  ]);
  const configured = config.threadId;
  const initialThreadId =
    (isSignal(configured) ? untracked(configured) : configured) ?? null;

  let active: Binding | undefined;
  /** The latest binding whose session has not resolved yet. */
  let pending: Binding | undefined;
  /** Commands called while a session is pending, run once it is adopted. */
  const waiting: { run(): void; fail(error: unknown): void }[] = [];
  /** Whether the active session is still reading its thread's history. */
  let activeLoading = false;
  let destroyed = false;
  // An empty idle conversation until the first session is adopted.
  const source: WritableSignal<object> = signal<object>(EMPTY_SNAPSHOT);
  const threadId = signal<string | null>(initialThreadId);
  const isThreadLoading = signal(false);
  const sessionEpoch = signal(0);
  const stopListeners = new Set<() => void>();
  const customEvents = signal<readonly AgentSessionCustomEvent[]>([]);
  const customListeners = new Set<(event: AgentSessionCustomEvent) => void>();
  const marks = Object.fromEntries(
    LIFECYCLE_KEYS.map((key) => [key, signal<unknown>(null)])
  ) as Record<(typeof LIFECYCLE_KEYS)[number], WritableSignal<unknown>>;
  const lifecycle = Object.freeze(
    Object.fromEntries(
      LIFECYCLE_KEYS.map((key) => [key, marks[key].asReadonly()])
    )
  ) as unknown as AgentLifecycle;
  /** The session's lifecycle has no such milestone unless a runtime adds one. */
  let createdAt: number | null = null;
  let sessionMarks: Members | undefined;

  function publishLifecycle() {
    for (const key of LIFECYCLE_KEYS) {
      const reported = sessionMarks?.[key] ?? null;
      marks[key].set(
        key === 'threadCreatedAt' ? reported ?? createdAt : reported
      );
    }
  }

  function adoptThreadId(id: string) {
    // Untracked: a session may report from inside a caller's effect.
    if (typeof id !== 'string' || !id || id === untracked(threadId)) return;
    threadId.set(id);
    createdAt = Date.now();
    publishLifecycle();
    try {
      config.onThreadId?.(id);
    } catch {
      /* As in the session contract: a throwing callback affects nothing. */
    }
  }

  function release(binding: Binding) {
    for (const undo of binding.releases.splice(0)) settle(undo);
  }

  function bind(next: string | null) {
    const binding: Binding = { threadId: next, releases: [] };
    pending = binding;
    if (next !== null) isThreadLoading.set(true);
    // The factory runs before anything is torn down: if it throws or rejects,
    // the agent stays on the session it has.
    let created: unknown;
    try {
      created = runInInjectionContext(injector, () =>
        untracked(() =>
          config.createSession({
            threadId: next,
            onThreadId: (id) => {
              if (!binding.session) binding.reported = id;
              else if (active === binding) adoptThreadId(id);
            },
            clientOptions,
            reportOperationFailure,
            developmentRuntime: ɵrelayDevelopmentRuntime,
          })
        )
      );
    } catch (error) {
      failed(binding, error);
      throw error;
    }
    if (created && typeof (created as PromiseLike<unknown>).then === 'function')
      (created as PromiseLike<AgentSessionLike>).then(
        (session) => untracked(() => adopt(binding, session)),
        (error: unknown) => failed(binding, error)
      );
    // A session returned as is, as the in-package testing provider does.
    else adopt(binding, created as AgentSessionLike);
  }

  /** The pending session failed: keep the current one, fail the waiting commands. */
  function failed(binding: Binding, error: unknown) {
    if (pending !== binding) return;
    pending = undefined;
    isThreadLoading.set(activeLoading);
    for (const entry of waiting.splice(0)) entry.fail(error);
  }

  /** Drops a pending switch, as when the followed thread changes back. */
  function cancelPending() {
    if (!pending) return;
    pending = undefined;
    isThreadLoading.set(activeLoading);
    for (const entry of waiting.splice(0)) entry.run();
  }

  function adopt(binding: Binding, session: AgentSessionLike) {
    // A session the agent has moved on from, or outlived, is never shown.
    if (destroyed || pending !== binding) {
      settle(() => session.dispose());
      return;
    }
    pending = undefined;
    binding.session = session;

    const previous = active;
    if (previous) {
      // Released first, so nothing the old session does while it stops can
      // reach the signals.
      release(previous);
      const old = previous.session as AgentSessionLike & Members;
      if (typeof old['stop'] === 'function')
        settle(() => (old['stop'] as () => unknown)());
      settle(() => old.dispose());
    }
    active = binding;

    let snapshot = session.getSnapshot();
    source.set(snapshot);
    threadId.set(binding.threadId);
    if (previous) sessionEpoch.update((epoch) => epoch + 1);
    customEvents.set([]);
    createdAt = null;

    binding.releases.push(
      session.subscribe(() => {
        if (active !== binding) return;
        const published = session.getSnapshot();
        const began =
          (published as Members)['status'] === 'running' &&
          (snapshot as Members)['status'] !== 'running';
        snapshot = published;
        // A new run starts with no retained events, as each run always has.
        if (began && untracked(customEvents).length) customEvents.set([]);
        source.set(published);
      })
    );

    const listen = (session as AgentSessionLike & Members)['onCustomEvent'];
    if (typeof listen === 'function')
      binding.releases.push(
        (
          listen as (
            listener: (event: AgentSessionCustomEvent) => void
          ) => () => void
        ).call(session, (event) => {
          if (active !== binding) return;
          customEvents.update((events) => [...events, event]);
          for (const listener of [...customListeners]) {
            if (!customListeners.has(listener)) continue;
            try {
              listener(event);
            } catch {
              /* A listener that throws affects no other listener. */
            }
          }
        })
      );

    const milestones = lifecycleSource(session);
    sessionMarks = milestones?.getSnapshot();
    if (milestones)
      binding.releases.push(
        milestones.subscribe(() => {
          if (active !== binding) return;
          sessionMarks = milestones.getSnapshot();
          publishLifecycle();
        })
      );
    publishLifecycle();
    if (binding.reported !== undefined) adoptThreadId(binding.reported);

    const load = (session as AgentSessionLike & Members)['load'];
    // Commands that waited for this session run on it now.
    const flush = () => {
      for (const entry of waiting.splice(0)) entry.run();
    };
    if (binding.threadId === null || typeof load !== 'function') {
      activeLoading = false;
      isThreadLoading.set(false);
      flush();
      return;
    }
    activeLoading = true;
    isThreadLoading.set(true);
    const finished = () => {
      // A read the agent has moved on from says nothing about this thread.
      if (active !== binding) return;
      activeLoading = false;
      if (!pending) isThreadLoading.set(false);
    };
    try {
      Promise.resolve((load as () => unknown).call(session)).then(
        finished,
        finished
      );
    } catch {
      finished();
    }
    flush();
  }

  function switchThread(next: string | null) {
    if (next !== null && (typeof next !== 'string' || !next))
      throw new TypeError('switchThread takes a nonempty thread id or null.');
    if (destroyed) return;
    untracked(() => bind(next));
  }

  untracked(() => bind(initialThreadId));
  registry.register(lifecycle);
  destroyRef.onDestroy(() => {
    destroyed = true;
    registry.unregister(lifecycle);
    const last = active;
    active = undefined;
    // A session still pending is disposed when it resolves.
    pending = undefined;
    const destroyedError = new Error('The agent was destroyed.');
    for (const entry of waiting.splice(0)) entry.fail(destroyedError);
    customListeners.clear();
    stopListeners.clear();
    if (!last) return;
    release(last);
    settle(() => (last.session as AgentSessionLike).dispose());
  });

  if (isSignal(configured))
    effect(() => {
      const next = configured() ?? null;
      // An id the session itself reported is already current: adopting it is
      // not a switch, so the run that created the thread keeps going.
      untracked(() => {
        if (destroyed) return;
        // Back to the shown thread before a pending switch resolved: drop it.
        if (pending && next === threadId()) cancelPending();
        else if (next !== (pending ? pending.threadId : threadId())) bind(next);
      });
    });

  const session = () => (active?.session ?? {}) as Members;
  const controls: Members = {
    threadId: threadId.asReadonly(),
    isThreadLoading: isThreadLoading.asReadonly(),
    switchThread,
    sessionEpoch: sessionEpoch.asReadonly(),
    onStop(listener: () => void): () => void {
      if (destroyed) return () => undefined;
      const entry = () => listener();
      stopListeners.add(entry);
      return () => {
        stopListeners.delete(entry);
      };
    },
    customEvents: customEvents.asReadonly(),
    lifecycle,
  };
  /** Outlives a thread switch, which a listener on one session would not. */
  const onCustomEvent = (
    listener: (event: AgentSessionCustomEvent) => void
  ): (() => void) => {
    if (destroyed) return () => undefined;
    const entry = (event: AgentSessionCustomEvent) => listener(event);
    customListeners.add(entry);
    return () => {
      customListeners.delete(entry);
    };
  };
  const commands = new Map<string, (...args: unknown[]) => unknown>();
  const fields = new Map<string, Signal<unknown>>();

  function command(key: string) {
    if (key === 'onCustomEvent') return onCustomEvent;
    let wrapper = commands.get(key);
    if (!wrapper) {
      // Bound late: the same function serves whichever session is current.
      wrapper = (...args) => {
        if (key === 'stop')
          for (const listener of [...stopListeners]) {
            if (!stopListeners.has(listener)) continue;
            try {
              // Untracked: stop may be called from inside a caller's effect.
              untracked(listener);
            } catch {
              /* A listener that throws cannot keep the session running. */
            }
          }
        const call = () => {
          const current = session();
          return (current[key] as (...args: unknown[]) => unknown).apply(
            current,
            args
          );
        };
        if (key === 'stop') return active ? call() : Promise.resolve();
        // A session is on its way: run on it once it is adopted.
        if (pending || !active)
          return new Promise((resolve, reject) => {
            if (!pending) {
              reject(new Error('The agent has no session.'));
              return;
            }
            waiting.push({
              run: () => {
                try {
                  resolve(call());
                } catch (error) {
                  reject(error);
                }
              },
              fail: reject,
            });
          });
        return call();
      };
      commands.set(key, wrapper);
    }
    return wrapper;
  }

  function field(key: string) {
    let value = fields.get(key);
    if (!value) {
      // A computed notifies only when this field's own value changes.
      value = computed(() => (source() as Members)[key]);
      fields.set(key, value);
    }
    return value;
  }

  function isMember(key: string) {
    if (Object.hasOwn(controls, key)) return true;
    if (PLUMBING.has(key)) return false;
    if (!active && REQUIRED_COMMANDS.has(key)) return true;
    return holds(session(), key) || holds(untracked(source), key);
  }

  function read(key: string): unknown {
    if (Object.hasOwn(controls, key)) return controls[key];
    if (PLUMBING.has(key)) return undefined;
    // The commands every session has exist before the first one is adopted.
    if (!active && REQUIRED_COMMANDS.has(key)) return command(key);
    const current = session();
    if (holds(current, key)) {
      const member = current[key];
      return typeof member === 'function' ? command(key) : member;
    }
    if (holds(untracked(source), key)) return field(key);
    // Absent from both: an optional command the session lacks, or an optional
    // field the snapshot does not hold yet.
    if (
      optionalCommands.has(key) ||
      NEVER_FIELDS.has(key) ||
      !FIELD_NAME.test(key)
    )
      return undefined;
    return field(key);
  }

  const agent = new Proxy(Object.create(null) as Members, {
    get: (_target, key) => (typeof key === 'string' ? read(key) : undefined),
    has: (_target, key) => typeof key === 'string' && isMember(key),
    ownKeys: () =>
      [
        ...new Set([
          ...Object.keys(controls),
          ...(active ? [] : [...REQUIRED_COMMANDS]),
          ...Object.keys(session()),
          ...Object.keys(untracked(source)),
        ]),
      ].filter(isMember),
    getOwnPropertyDescriptor: (_target, key) =>
      typeof key === 'string' && isMember(key)
        ? {
            value: read(key),
            writable: false,
            enumerable: true,
            configurable: true,
          }
        : undefined,
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  }) as unknown as Agent<TSession>;
  configs.set(agent, config);
  const developmentPolicy = () => {
    const current = session();
    const enabled = current['isDevelopmentRuntimeEnabled'];
    return typeof enabled === 'function' && enabled.call(current) === true;
  };
  // Also used for an agent derived from this one, which is another object.
  const registerPolicy = (target: object) => {
    try {
      registerDevelopmentRuntime(target, developmentPolicy);
    } catch {
      /* Optional collection never affects the agent. */
    }
  };
  policyRegistrations.set(agent, registerPolicy);
  registerPolicy(agent);
  return agent;
}
