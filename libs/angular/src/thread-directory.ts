import {
  DestroyRef,
  InjectionToken,
  computed,
  inject,
  signal,
  type Provider,
  type Signal,
} from '@angular/core';
import type {
  AgentError,
  PlainValue,
  ProjectEntry,
  ThreadDirectory,
  ThreadDirectorySnapshot,
  ThreadDirectoryStatus,
  ThreadEntry,
} from '@threadplane/core';
import {
  AGENT_CLIENT_OPTIONS,
  ɵAGENT_OPERATION_FAILURE_REPORTER,
  type AgentOperationFailureReporter,
} from './agent-tokens';

/**
 * One thread as a list shows it: the directory's entry, plus `status` for
 * views that read a lifecycle rather than the `archived` flag. It is a type
 * alias so it binds to a thread list input that allows extra fields.
 */
export type ThreadListItem = {
  readonly id: string;
  /** Always a string: the directory applies its fallback title. */
  readonly title: string;
  readonly updatedAt?: number;
  readonly status: 'active' | 'archived';
  readonly pinned: boolean;
  /**
   * The saved rank among pinned threads, when the directory keeps one
   * (`ThreadDirectory.pinnedOrderOf`). `threads()` is already in this order.
   */
  readonly pinnedOrder?: number;
  readonly archived: boolean;
  readonly projectId: string | null;
};

/** What a directory factory is given when the view is built. */
export interface ThreadDirectoryContext {
  /** The app-wide `AGENT_CLIENT_OPTIONS`, when provided. */
  readonly clientOptions: object | undefined;
  /** The host's operation failure reporter, when provided. */
  readonly reportOperationFailure: AgentOperationFailureReporter | undefined;
}

/** Configuration for one injected thread directory view. */
export interface ThreadDirectoryConfig<
  TDirectory extends ThreadDirectory = ThreadDirectory
> {
  /**
   * Creates the directory. Called once, in the view's injection context, so it
   * may call `inject()`. The view owns the directory and disposes it.
   */
  readonly createDirectory: (context: ThreadDirectoryContext) => TDirectory;
  /**
   * Reads one thread from the backend: the entry, or null when the backend
   * says there is no such thread. Reject when the backend could not be asked.
   * Used by `getThread` in place of the directory's own `get`.
   */
  readonly getThread?: (
    threadId: string,
    directory: TDirectory
  ) => Promise<ThreadEntry | null>;
}

/** A config, or a factory for one that runs in an injection context. */
export type ThreadDirectoryConfigInput<TDirectory extends ThreadDirectory> =
  | ThreadDirectoryConfig<TDirectory>
  | (() => ThreadDirectoryConfig<TDirectory>);

/**
 * A view command that stands on an optional directory command: always present
 * when the directory's type guarantees the command, otherwise possibly
 * undefined, so a caller offers no control for it.
 */
export type ThreadDirectoryCommand<
  TDirectory extends ThreadDirectory,
  K extends keyof ThreadDirectory,
  TCommand
> = TCommand | (TDirectory[K] & undefined);

/**
 * The instance an Angular component injects for the thread list: a
 * `ThreadDirectory`'s snapshot fields as signals, and its commands under the
 * names thread list views use for row actions, so the view itself can be bound
 * as a list's action adapter.
 *
 * A command the directory does not offer is `undefined`. Every command that
 * changes a thread shows at once and rolls back when it fails, as the
 * directory does it, and rejects with the directory's own error.
 *
 * The object is stable for the life of its injector, which disposes the
 * directory. After that the signals keep their last values.
 */
export interface ThreadDirectoryView<
  TDirectory extends ThreadDirectory = ThreadDirectory
> {
  /** Active threads, pinned first, in the directory's order. */
  readonly threads: Signal<ThreadListItem[]>;
  /** Archived threads. */
  readonly archivedThreads: Signal<ThreadListItem[]>;
  /**
   * Project names. `undefined` when the directory has no projects or cannot
   * read them, so a view hides its projects section.
   */
  readonly projects: Signal<readonly ProjectEntry[] | undefined>;
  /**
   * `'loading'` until the first successful load and while recovering from an
   * error, `'error'` after a failed load, otherwise `'idle'`.
   */
  readonly status: Signal<ThreadDirectoryStatus>;
  /** The last load failure; cleared by a successful load. */
  readonly error: Signal<AgentError | undefined>;
  /** True while `status()` is `'loading'`. */
  readonly isLoading: Signal<boolean>;
  /**
   * The directory underneath, for a view that takes a `ThreadDirectory`. It is
   * the one object for the life of the view. Do not dispose it: the view does.
   */
  readonly directory: TDirectory;

  /**
   * Reads the thread list again. A failed load is published through `status`
   * and `error`; the promise does not reject for it.
   */
  refresh(options?: { readonly signal?: AbortSignal }): Promise<void>;
  /**
   * Reads one thread: the thread, or null when the backend says it does not
   * exist. It rejects when that could not be determined, so a caller can keep
   * the thread it was asking about.
   *
   * The answer comes from `ThreadDirectoryConfig.getThread`, else from the
   * directory's `get`, which the core contract leaves optional. With neither,
   * only a thread the directory lists can be answered for: the list is read
   * once if the thread is not in it, and a thread still not listed rejects,
   * because a list is not proof of absence.
   */
  getThread(threadId: string): Promise<ThreadListItem | null>;
  /**
   * Creates a thread and resolves with its id, or with null when the request
   * failed; the failure is logged with `console.error`.
   */
  readonly create: ThreadDirectoryCommand<
    TDirectory,
    'create',
    (metadata?: { readonly [key: string]: PlainValue }) => Promise<
      string | null
    >
  >;
  readonly rename: ThreadDirectoryCommand<
    TDirectory,
    'rename',
    (threadId: string, newTitle: string) => Promise<void>
  >;
  readonly delete: ThreadDirectoryCommand<
    TDirectory,
    'remove',
    (threadId: string) => Promise<void>
  >;
  readonly archive: ThreadDirectoryCommand<
    TDirectory,
    'setArchived',
    (threadId: string) => Promise<void>
  >;
  readonly unarchive: ThreadDirectoryCommand<
    TDirectory,
    'setArchived',
    (threadId: string) => Promise<void>
  >;
  readonly pin: ThreadDirectoryCommand<
    TDirectory,
    'setPinned',
    (threadId: string) => Promise<void>
  >;
  readonly unpin: ThreadDirectoryCommand<
    TDirectory,
    'setPinned',
    (threadId: string) => Promise<void>
  >;
  /** Moves a thread into a project, or out of any project with null. */
  readonly moveToProject: ThreadDirectoryCommand<
    TDirectory,
    'setProject',
    (threadId: string, projectId: string | null) => Promise<void>
  >;
  /**
   * Places a pinned thread before another pinned thread, or last with null or
   * an id that is not pinned.
   */
  readonly reorderPinned: ThreadDirectoryCommand<
    TDirectory,
    'reorderPinned',
    (threadId: string, beforeId: string | null) => Promise<void>
  >;
  readonly createProject: ThreadDirectoryCommand<
    TDirectory,
    'createProject',
    (name: string) => Promise<{ readonly id: string }>
  >;
  readonly renameProject: ThreadDirectoryCommand<
    TDirectory,
    'renameProject',
    (projectId: string, name: string) => Promise<void>
  >;
  /** Removes a project; its threads leave it first. */
  readonly removeProject: ThreadDirectoryCommand<
    TDirectory,
    'removeProject',
    (projectId: string) => Promise<void>
  >;
}

/**
 * Builds the {@link ThreadDirectoryView} for a directory factory. Call it in
 * an injection context; `provideThreadDirectory` does. The directory is
 * created at once and disposed when the injection context is destroyed.
 *
 * Nothing is loaded until `refresh()` is called, by the app or by a view that
 * refreshes the directory when it mounts.
 */
export function createThreadDirectoryView<TDirectory extends ThreadDirectory>(
  config: ThreadDirectoryConfig<TDirectory>
): ThreadDirectoryView<TDirectory> {
  const destroyRef = inject(DestroyRef);
  const clientOptions =
    inject(AGENT_CLIENT_OPTIONS, { optional: true }) ?? undefined;
  const reportOperationFailure =
    inject(ɵAGENT_OPERATION_FAILURE_REPORTER, { optional: true }) ?? undefined;
  const directory = config.createDirectory({
    clientOptions,
    reportOperationFailure,
  });

  const snapshot = signal<ThreadDirectorySnapshot>(directory.getSnapshot());
  let destroyed = false;
  const release = directory.subscribe(() => {
    if (!destroyed) snapshot.set(directory.getSnapshot());
  });
  destroyRef.onDestroy(() => {
    destroyed = true;
    try {
      release();
    } catch {
      /* A directory being destroyed cannot fail its injector. */
    }
    try {
      directory.dispose();
    } catch {
      /* As above. */
    }
  });

  // An unchanged entry keeps its item, so a list re-renders only the rows
  // that changed.
  const items = new WeakMap<ThreadEntry, ThreadListItem>();
  const toItem = (entry: ThreadEntry): ThreadListItem => {
    let item = items.get(entry);
    if (!item) {
      const pinnedOrder = directory.pinnedOrderOf?.(entry);
      item = Object.freeze({
        id: entry.id,
        title: entry.title,
        ...(entry.updatedAt === undefined
          ? {}
          : { updatedAt: entry.updatedAt }),
        status: entry.archived ? 'archived' : 'active',
        pinned: entry.pinned,
        ...(pinnedOrder === undefined ? {} : { pinnedOrder }),
        archived: entry.archived,
        projectId: entry.projectId,
      });
      items.set(entry, item);
    }
    return item;
  };
  // Each list follows its own array, which the directory keeps while nothing
  // in it changed.
  const active = computed(() => snapshot().threads);
  const archived = computed(() => snapshot().archived);
  const status = computed(() => snapshot().status);

  /** Late-bound: the directory's command, called on the directory. */
  const bound = <K extends keyof ThreadDirectory>(key: K) => {
    const command = directory[key];
    return typeof command === 'function'
      ? (command as (...args: never[]) => unknown).bind(directory)
      : undefined;
  };
  const create = bound('create') as ThreadDirectory['create'];
  const rename = bound('rename') as ThreadDirectory['rename'];
  const remove = bound('remove') as ThreadDirectory['remove'];
  const setArchived = bound('setArchived') as ThreadDirectory['setArchived'];
  const setPinned = bound('setPinned') as ThreadDirectory['setPinned'];
  const setProject = bound('setProject') as ThreadDirectory['setProject'];

  const listed = (threadId: string): ThreadEntry | undefined => {
    const current = directory.getSnapshot();
    return (
      current.threads.find((entry) => entry.id === threadId) ??
      current.archived.find((entry) => entry.id === threadId)
    );
  };
  const own = directory.get;
  const readOne =
    config.getThread ??
    (typeof own === 'function'
      ? (threadId: string) => own.call(directory, threadId)
      : undefined);

  const view: ThreadDirectoryView = {
    threads: computed(() => active().map(toItem)),
    archivedThreads: computed(() => archived().map(toItem)),
    projects: computed(() => snapshot().projects),
    status,
    error: computed(() => snapshot().error),
    isLoading: computed(() => status() === 'loading'),
    directory,
    refresh: (options) => directory.refresh(options),
    async getThread(threadId) {
      if (readOne) {
        const entry = await readOne(threadId, directory);
        return entry ? toItem(entry) : null;
      }
      let entry = listed(threadId);
      if (!entry) {
        await directory.refresh();
        entry = listed(threadId);
      }
      if (entry) return toItem(entry);
      throw new Error(
        'getThread: the thread is not in the list, and this directory cannot read a single thread.'
      );
    },
    create:
      create &&
      (async (metadata = {}) => {
        try {
          return (await create({ metadata })).id;
        } catch (error) {
          console.error('[ThreadDirectoryView.create] failed:', error);
          return null;
        }
      }),
    rename,
    delete: remove,
    archive: setArchived && ((threadId) => setArchived(threadId, true)),
    unarchive: setArchived && ((threadId) => setArchived(threadId, false)),
    pin: setPinned && ((threadId) => setPinned(threadId, true)),
    unpin: setPinned && ((threadId) => setPinned(threadId, false)),
    moveToProject: setProject,
    reorderPinned: bound('reorderPinned') as ThreadDirectory['reorderPinned'],
    createProject: bound('createProject') as ThreadDirectory['createProject'],
    renameProject: bound('renameProject') as ThreadDirectory['renameProject'],
    removeProject: bound('removeProject') as ThreadDirectory['removeProject'],
  };
  return Object.freeze(view) as ThreadDirectoryView<TDirectory>;
}

/** @internal The view `injectThreadDirectory()` resolves. */
export const ɵTHREAD_DIRECTORY = new InjectionToken<ThreadDirectoryView>(
  'THREAD_DIRECTORY'
);

/**
 * Provides one {@link ThreadDirectoryView}, built from a directory factory.
 * Retrieve it in any component with `injectThreadDirectory()`. Provide it at
 * the application root for an app-wide thread list, or in a component's
 * `providers` to give that subtree its own.
 *
 * The view creates its directory through `config.createDirectory`, so this
 * package depends on no backend. The directory is disposed when the providing
 * injector is destroyed.
 *
 * Pass the config object when it is known up front, or a
 * `() => ThreadDirectoryConfig` factory when it depends on injected state: the
 * factory runs once, in an injection context.
 *
 * @example
 * ```ts
 * providers: [
 *   provideThreadDirectory({
 *     createDirectory: ({ clientOptions, reportOperationFailure }) =>
 *       createLangGraphThreadDirectory({
 *         apiUrl,
 *         clientOptions,
 *         reportOperationFailure,
 *       }),
 *   }),
 * ];
 * ```
 */
export function provideThreadDirectory<TDirectory extends ThreadDirectory>(
  config: ThreadDirectoryConfigInput<TDirectory>
): Provider[] {
  return [
    {
      provide: ɵTHREAD_DIRECTORY,
      useFactory: () => {
        const resolved = typeof config === 'function' ? config() : config;
        if (typeof resolved?.createDirectory !== 'function')
          throw new TypeError(
            'provideThreadDirectory: `createDirectory` is required to build the thread directory.'
          );
        return createThreadDirectoryView(resolved);
      },
    },
  ];
}

/**
 * Retrieves the thread directory view provided in the current injection
 * context. The result is typed by the core contract, where every command is
 * optional; name the directory type, for example
 * `injectThreadDirectory<LangGraphThreadDirectory>()`, to have the commands it
 * guarantees typed as present, so they are called without `?.`. That is not
 * checked against the provider.
 *
 * @example
 * ```ts
 * readonly threads = injectThreadDirectory();
 * constructor() {
 *   void this.threads.refresh();
 *   refreshOnRunEnd(injectAgent(), this.threads);
 * }
 * ```
 */
export function injectThreadDirectory<
  TDirectory extends ThreadDirectory = ThreadDirectory
>(): ThreadDirectoryView<TDirectory> {
  return inject(ɵTHREAD_DIRECTORY) as unknown as ThreadDirectoryView<TDirectory>;
}
