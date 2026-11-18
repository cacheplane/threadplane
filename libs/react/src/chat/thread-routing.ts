import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useSyncExternalStore,
} from 'react';

/** How a thread change reaches history: a new entry, or an edit of the current one. */
export type ThreadRoutingWriteMode = 'push' | 'replace';

/**
 * Binds the active thread to a URL. The default adapter uses `window.location` and
 * `window.history`; React Router or Next.js applications can supply one built from
 * their own location and navigation functions.
 */
export interface ThreadRoutingAdapter {
  /** The thread id in the current URL, or null for the bare URL. */
  read(): string | null;
  /** Write a thread id (null clears it) to the URL. */
  write(threadId: string | null, mode: ThreadRoutingWriteMode): void;
  /** Call `onChange` when the URL changes outside `write`, such as back and forward. */
  subscribe(onChange: () => void): () => void;
}

/** Options for {@link useThreadRouting}. */
export interface ThreadRoutingOptions {
  /** Custom URL binding. When set, `basePath` and `param` are ignored. */
  readonly adapter?: ThreadRoutingAdapter;
  /**
   * Default adapter: the path the thread segment follows. `'/'` (default) gives
   * `/<threadId>`, `'/chat'` gives `/chat/<threadId>`. The query and hash are kept.
   */
  readonly basePath?: string;
  /** Default adapter: store the thread in this query parameter instead of the path. */
  readonly param?: string;
  /**
   * Checks that a thread from the URL still exists. When it answers false, the
   * URL is replaced with the bare URL. A rejected check keeps the thread.
   */
  readonly exists?: (threadId: string) => boolean | Promise<boolean>;
}

/** The active thread from the URL and the function that changes it. */
export interface ThreadRouting {
  readonly threadId: string | null;
  readonly setThreadId: (threadId: string | null) => void;
}

const noop = (): void => undefined;

function browser(): Window | undefined {
  return typeof window === 'undefined' ? undefined : window;
}

function normalizeBase(basePath: string): string {
  let end = basePath.length;
  while (end > 0 && basePath.charCodeAt(end - 1) === 47 /* '/' */) end -= 1;
  const trimmed = basePath.slice(0, end);
  return trimmed.startsWith('/') || trimmed === '' ? trimmed : `/${trimmed}`;
}

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function browserAdapter(basePath: string, param: string | undefined): ThreadRoutingAdapter {
  const base = normalizeBase(basePath);
  const listeners = new Set<() => void>();
  const notify = (): void => listeners.forEach((listener) => listener());

  const read = (): string | null => {
    const win = browser();
    if (!win) return null;
    if (param) return new URLSearchParams(win.location.search).get(param) || null;
    const path = win.location.pathname;
    if (path !== base && !path.startsWith(`${base}/`)) return null;
    const rest = path.slice(base.length).split('/').filter(Boolean);
    return rest.length === 1 ? decode(rest[0]) : null;
  };

  const write = (threadId: string | null, mode: ThreadRoutingWriteMode): void => {
    const win = browser();
    if (!win) return;
    const { pathname, search, hash } = win.location;
    let url: string;
    if (param) {
      const query = new URLSearchParams(search);
      if (threadId) query.set(param, threadId);
      else query.delete(param);
      const next = query.toString();
      url = `${pathname}${next ? `?${next}` : ''}${hash}`;
    } else {
      const path = threadId ? `${base}/${encodeURIComponent(threadId)}` : base || '/';
      url = `${path}${search}${hash}`;
    }
    if (mode === 'push') win.history.pushState(win.history.state, '', url);
    else win.history.replaceState(win.history.state, '', url);
    notify();
  };

  const subscribe = (onChange: () => void): (() => void) => {
    const win = browser();
    if (!win) return noop;
    listeners.add(onChange);
    win.addEventListener('popstate', onChange);
    return () => {
      listeners.delete(onChange);
      win.removeEventListener('popstate', onChange);
    };
  };

  return { read, write, subscribe };
}

const serverSnapshot = (): null => null;

/**
 * Keeps the active thread in the URL, the React counterpart of Angular
 * `injectThreadRouting`. The URL is the source of truth: the thread is restored
 * on load, selecting one pushes a history entry, back and forward are followed,
 * and a thread that `exists` rejects is replaced with the bare URL. The server
 * render and hydration read no URL and report no thread.
 *
 * @example
 * ```tsx
 * const { threadId, setThreadId } = useThreadRouting({
 *   exists: (id) => client.threads.get(id).then(() => true, () => false),
 * });
 * return <ThreadList threads={threads} activeThreadId={threadId} onSelect={setThreadId} />;
 * ```
 */
export function useThreadRouting(options: ThreadRoutingOptions = {}): ThreadRouting {
  const { adapter: custom, basePath = '/', param, exists } = options;
  const adapter = useMemo(
    () => custom ?? browserAdapter(basePath, param),
    [custom, basePath, param],
  );
  // A custom adapter may not notify on its own writes; re-render so the
  // snapshot is read again.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const threadId = useSyncExternalStore(adapter.subscribe, adapter.read, serverSnapshot);

  const setThreadId = useCallback(
    (next: string | null) => {
      if (next === adapter.read()) return;
      adapter.write(next, 'push');
      rerender();
    },
    [adapter],
  );

  const existsRef = useRef(exists);
  existsRef.current = exists;
  const checked = useRef<string | null>(null);
  const hasCheck = exists !== undefined;

  useEffect(() => {
    const check = existsRef.current;
    if (!check || !threadId || threadId === checked.current) return;
    checked.current = threadId;
    let answer: Promise<boolean>;
    try {
      answer = Promise.resolve(check(threadId));
    } catch {
      return;
    }
    answer.then(
      (ok) => {
        if (!ok && adapter.read() === threadId) {
          adapter.write(null, 'replace');
          rerender();
        }
      },
      noop,
    );
  }, [threadId, adapter, hasCheck]);

  return useMemo(() => ({ threadId, setThreadId }), [threadId, setThreadId]);
}
