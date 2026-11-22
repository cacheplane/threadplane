/** What `AgentProvider` hands its session factory each time it needs a session. */
export interface AgentSessionFactoryContext {
  /** The thread the new session belongs to, or null for a new empty one. */
  readonly threadId: string | null;
  /**
   * Tells the provider the id of a thread the session created. Pass it to the
   * session as its `onThreadId`. A report from a replaced session is ignored.
   */
  readonly onThreadId: (threadId: string) => void;
}

/** The members of a session the host relies on. */
export interface HostedSession {
  getSnapshot(): object;
  subscribe(notify: () => void): () => void;
  dispose(): unknown;
}

type Members = Record<string, unknown>;

/** The commands every session has: they exist before the first session does. */
const REQUIRED_COMMANDS = new Set(['submit', 'stop']);
/** Session plumbing the facade owns itself. */
const PLUMBING = new Set(['getSnapshot', 'subscribe', 'dispose']);

/**
 * What the facade shows before its first session: the core contract's
 * required fields, and the collections a first-party backend's snapshot always
 * holds, so a typed read of them is an empty list rather than `undefined`.
 */
const EMPTY_SNAPSHOT = Object.freeze({
  status: 'idle',
  messages: Object.freeze([]),
  toolCalls: Object.freeze([]),
  interrupts: Object.freeze([]),
  subgraphs: Object.freeze([]),
  subagents: Object.freeze([]),
});

interface Binding {
  readonly threadId: string | null;
  session?: HostedSession;
  reported?: string;
  release?: () => void;
}

function settle(run: () => unknown): void {
  try {
    const result = run();
    if (result && typeof (result as PromiseLike<unknown>).then === 'function')
      (result as PromiseLike<unknown>).then(undefined, () => undefined);
  } catch {
    /* A session being replaced or disposed cannot fail the host. */
  }
}

export interface SessionHostOptions<TSession extends HostedSession> {
  /** Read on each bind, so the latest factory is used. */
  readonly createSession: () => (
    context: AgentSessionFactoryContext
  ) => Promise<TSession>;
  readonly onThreadId?: () => ((threadId: string) => void) | undefined;
}

/**
 * Owns the sessions an async factory creates and exposes one stable,
 * session-shaped facade over whichever is current:
 *
 * - Before the first session resolves, the facade shows an empty idle
 *   conversation.
 * - On a thread switch it keeps the current session until the new one
 *   resolves; only the latest switch is adopted, and a superseded session is
 *   disposed.
 * - Commands called while a session is pending wait for it and run on it;
 *   `stop` goes to the current session at once.
 * - When the factory rejects, the host keeps its current session and the
 *   waiting commands reject with the factory's error.
 */
export function createSessionHost<TSession extends HostedSession>(
  options: SessionHostOptions<TSession>
) {
  let active: Binding | undefined;
  let pending: Binding | undefined;
  let connected = false;
  const waiting: { run(): void; fail(error: unknown): void }[] = [];
  const listeners = new Set<() => void>();
  let threadId: string | null = null;

  const notify = () => {
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue;
      try {
        listener();
      } catch {
        /* A listener that throws affects no other listener. */
      }
    }
  };
  const current = () => (active?.session ?? {}) as Members;

  function release(binding: Binding) {
    binding.release?.();
    binding.release = undefined;
  }

  function bind(next: string | null) {
    const binding: Binding = { threadId: next };
    pending = binding;
    const factory = options.createSession();
    let created: Promise<TSession>;
    try {
      created = factory({
        threadId: next,
        onThreadId: (id) => {
          if (!binding.session) binding.reported = id;
          else if (active === binding) adoptThreadId(id);
        },
      });
    } catch (error) {
      failed(binding, error);
      return;
    }
    Promise.resolve(created).then(
      (session) => adopt(binding, session),
      (error: unknown) => failed(binding, error)
    );
  }

  function adoptThreadId(id: string) {
    if (typeof id !== 'string' || !id || id === threadId) return;
    threadId = id;
    try {
      options.onThreadId?.()?.(id);
    } catch {
      /* A throwing callback affects nothing. */
    }
  }

  function failed(binding: Binding, error: unknown) {
    if (pending !== binding) return;
    pending = undefined;
    for (const entry of waiting.splice(0)) entry.fail(error);
  }

  function adopt(binding: Binding, session: TSession) {
    if (!connected || pending !== binding) {
      settle(() => session.dispose());
      return;
    }
    pending = undefined;
    binding.session = session;
    const previous = active;
    if (previous) {
      release(previous);
      const old = previous.session as unknown as Members;
      if (typeof old['stop'] === 'function')
        settle(() => (old['stop'] as () => unknown).call(old));
      settle(() => previous.session?.dispose());
    }
    active = binding;
    threadId = binding.threadId;
    binding.release = session.subscribe(() => {
      if (active === binding) notify();
    });
    if (binding.reported !== undefined) adoptThreadId(binding.reported);
    notify();
    for (const entry of waiting.splice(0)) entry.run();
  }

  const commands = new Map<string, (...args: unknown[]) => unknown>();
  function command(key: string) {
    let wrapper = commands.get(key);
    if (wrapper) return wrapper;
    wrapper = (...args: unknown[]) => {
      const call = () => {
        const target = current();
        return (target[key] as (...a: unknown[]) => unknown).apply(
          target,
          args
        );
      };
      if (key === 'stop') return active ? call() : Promise.resolve();
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
    return wrapper;
  }

  const plumbing: Members = {
    getSnapshot: () => (active?.session ?? null)?.getSnapshot() ?? EMPTY_SNAPSHOT,
    subscribe: (listener: () => void) => {
      const entry = () => listener();
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
    // The provider owns its sessions: a consumer cannot dispose them.
    dispose: () => Promise.resolve(),
  };

  function has(key: string): boolean {
    if (PLUMBING.has(key)) return true;
    if (REQUIRED_COMMANDS.has(key)) return true;
    const target = current();
    return key in target && !(key in Object.prototype);
  }

  function read(key: string): unknown {
    if (PLUMBING.has(key)) return plumbing[key];
    if (REQUIRED_COMMANDS.has(key)) return command(key);
    const target = current();
    if (!(key in target) || key in Object.prototype) return undefined;
    const member = target[key];
    return typeof member === 'function' ? command(key) : member;
  }

  /** One stable object that behaves as the current session. */
  const session = new Proxy(Object.create(null) as Members, {
    get: (_target, key) => (typeof key === 'string' ? read(key) : undefined),
    has: (_target, key) => typeof key === 'string' && has(key),
    ownKeys: () =>
      [
        ...new Set([
          ...PLUMBING,
          ...REQUIRED_COMMANDS,
          ...Object.keys(current()),
        ]),
      ].filter(has),
    getOwnPropertyDescriptor: (_target, key) =>
      typeof key === 'string' && has(key)
        ? { value: read(key), writable: false, enumerable: true, configurable: true }
        : undefined,
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  }) as unknown as TSession;

  return {
    session,
    /** The thread the current session belongs to. */
    threadId: () => threadId,
    /** Starts (or restarts) the host on a thread. */
    connect(next: string | null) {
      connected = true;
      bind(next);
    },
    /** Switches threads; a pending switch to the shown thread is dropped. */
    switchThread(next: string | null) {
      if (!connected) return;
      if (pending && next === threadId && active) {
        pending = undefined;
        for (const entry of waiting.splice(0)) entry.run();
        return;
      }
      if (next !== (pending ? pending.threadId : threadId) || !active) bind(next);
    },
    /** Disposes every session; the facade shows the empty conversation again. */
    disconnect() {
      connected = false;
      pending = undefined;
      const error = new Error('The agent provider was unmounted.');
      for (const entry of waiting.splice(0)) entry.fail(error);
      const last = active;
      active = undefined;
      threadId = null;
      if (last) {
        release(last);
        settle(() => last.session?.dispose());
      }
      notify();
    },
  };
}
