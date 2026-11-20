import { signal, type Provider, type Signal } from '@angular/core';
import type {
  AgentError,
  AgentSession,
  PlainValue,
  ProjectEntry,
  ThreadDirectory,
  ThreadDirectoryStatus,
  ThreadEntry,
} from '@threadplane/core';
import {
  createThreadDirectoryView,
  injectThreadDirectory,
  provideThreadDirectory,
  refreshOnRunEnd,
  refreshOnTransition,
  type Agent,
  type AgentOperationFailureReporter,
  type ThreadDirectoryConfig,
  type ThreadDirectoryContext,
  type ThreadDirectoryView,
  type ThreadListItem,
} from './public-api.js';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Type-only proof against the actual LangGraph directory; no production dependency.
import type { createLangGraphThreadDirectory } from '../../langgraph/src/runtime/thread-directory';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Type-only proof against the actual LangGraph session.
import type { LangGraphSession } from '../../langgraph/src/runtime/create-session';

type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Expect<T extends true> = T;

/** The view over the core contract: every signal typed, every command optional. */
export function coreView(view: ThreadDirectoryView) {
  type Threads = Expect<Same<typeof view.threads, Signal<ThreadListItem[]>>>;
  type Archived = Expect<
    Same<typeof view.archivedThreads, Signal<ThreadListItem[]>>
  >;
  type Projects = Expect<
    Same<typeof view.projects, Signal<readonly ProjectEntry[] | undefined>>
  >;
  type Status = Expect<
    Same<typeof view.status, Signal<ThreadDirectoryStatus>>
  >;
  type Failure = Expect<
    Same<typeof view.error, Signal<AgentError | undefined>>
  >;
  type Loading = Expect<Same<typeof view.isLoading, Signal<boolean>>>;
  type Directory = Expect<Same<typeof view.directory, ThreadDirectory>>;
  type Refresh = Expect<
    Same<
      typeof view.refresh,
      (options?: { readonly signal?: AbortSignal }) => Promise<void>
    >
  >;
  type GetThread = Expect<
    Same<
      typeof view.getThread,
      (threadId: string) => Promise<ThreadListItem | null>
    >
  >;
  type Create = Expect<
    Same<
      typeof view.create,
      | ((metadata?: {
          readonly [key: string]: PlainValue;
        }) => Promise<string | null>)
      | undefined
    >
  >;
  type Rename = Expect<
    Same<
      typeof view.rename,
      ((threadId: string, newTitle: string) => Promise<void>) | undefined
    >
  >;
  type Delete = Expect<
    Same<typeof view.delete, ((threadId: string) => Promise<void>) | undefined>
  >;
  type Move = Expect<
    Same<
      typeof view.moveToProject,
      | ((threadId: string, projectId: string | null) => Promise<void>)
      | undefined
    >
  >;
  type CreateProject = Expect<
    Same<
      typeof view.createProject,
      ((name: string) => Promise<{ readonly id: string }>) | undefined
    >
  >;

  // A command the directory may lack is asked for before it is called.
  // @ts-expect-error The core contract does not guarantee rename.
  void view.rename('a', 'Title');
  void view.rename?.('a', 'Title');
  void view.archive?.('a');
  void view.unarchive?.('a');
  void view.pin?.('a');
  void view.unpin?.('a');
  void view.reorderPinned?.('a', null);
  void view.renameProject?.('p', 'Name');
  void view.removeProject?.('p');
  // @ts-expect-error The signals are read-only.
  view.threads.set([]);
  // @ts-expect-error The view's members cannot be replaced.
  view.directory = {} as ThreadDirectory;
  // @ts-expect-error A title is required to rename.
  void view.rename?.('a');
  // @ts-expect-error Metadata is plain data.
  void view.create?.({ when: new Date() });

  const item = view.threads()[0];
  type Title = Expect<Same<typeof item.title, string>>;
  type ItemStatus = Expect<Same<typeof item.status, 'active' | 'archived'>>;
  type Updated = Expect<Same<typeof item.updatedAt, number | undefined>>;
  type Project = Expect<Same<typeof item.projectId, string | null>>;
  // @ts-expect-error An item is read-only.
  item.title = 'x';
  // The item carries the whole directory entry.
  const asEntry: ThreadEntry = item;
  void asEntry;
  return {} as [
    Threads,
    Archived,
    Projects,
    Status,
    Failure,
    Loading,
    Directory,
    Refresh,
    GetThread,
    Create,
    Rename,
    Delete,
    Move,
    CreateProject,
    Title,
    ItemStatus,
    Updated,
    Project
  ];
}

/** A directory type that guarantees a command makes the view's command present. */
interface FullDirectory extends ThreadDirectory {
  rename(id: string, title: string): Promise<void>;
  remove(id: string): Promise<void>;
  setArchived(id: string, archived: boolean): Promise<void>;
  create(): Promise<{ readonly id: string }>;
  /** A backend's own command stays reachable through `directory`. */
  search(text: string): Promise<readonly ThreadEntry[]>;
}

export function typedView(view: ThreadDirectoryView<FullDirectory>) {
  void view.rename('a', 'Title');
  void view.delete('a');
  void view.archive('a');
  void view.unarchive('a');
  void view.create();
  // @ts-expect-error This directory type does not guarantee pinning.
  void view.pin('a');
  void view.pin?.('a');
  void view.directory.search('trip');
  type Directory = Expect<Same<typeof view.directory, FullDirectory>>;
  // A typed view is still a view of the core contract.
  const core: ThreadDirectoryView = view;
  void core;
  return {} as Directory;
}

/** The provider, the injector function and the factory context. */
export function providers(full: FullDirectory) {
  const provided: Provider[] = provideThreadDirectory({
    createDirectory: (context) => {
      type Context = Expect<Same<typeof context, ThreadDirectoryContext>>;
      const options: object | undefined = context.clientOptions;
      const report: AgentOperationFailureReporter | undefined =
        context.reportOperationFailure;
      void [options, report];
      return full as FullDirectory & Context;
    },
    getThread: async (threadId, directory) => {
      const id: string = threadId;
      const found = await directory.search(id);
      return found[0] ?? null;
    },
  });
  provideThreadDirectory(() => ({ createDirectory: () => full }));
  // @ts-expect-error A directory factory is required.
  provideThreadDirectory({});
  provideThreadDirectory({
    // @ts-expect-error The factory must return a thread directory.
    createDirectory: () => ({ refresh: async () => undefined }),
  });
  provideThreadDirectory({
    createDirectory: () => full,
    // @ts-expect-error A reader answers with an entry or null.
    getThread: async () => 'a',
  });

  const plain = injectThreadDirectory();
  type Plain = Expect<Same<typeof plain, ThreadDirectoryView<ThreadDirectory>>>;
  const named = injectThreadDirectory<FullDirectory>();
  type Named = Expect<Same<typeof named, ThreadDirectoryView<FullDirectory>>>;
  const built = createThreadDirectoryView({ createDirectory: () => full });
  type Built = Expect<Same<typeof built, ThreadDirectoryView<FullDirectory>>>;
  const config: ThreadDirectoryConfig = {
    createDirectory: () => full,
  };
  void [provided, config, plain, named, built];
  return {} as [Plain, Named, Built];
}

/** The real LangGraph directory provides a view with no cast. */
export function langGraphDirectory(
  create: typeof createLangGraphThreadDirectory
) {
  provideThreadDirectory({
    createDirectory: ({ clientOptions }) =>
      create({ apiUrl: '/api', clientOptions }),
  });
  const view = createThreadDirectoryView({
    createDirectory: () => create({ apiUrl: '/api' }),
  });
  type View = Expect<Same<typeof view, ThreadDirectoryView<ThreadDirectory>>>;
  void view;
  return {} as View;
}

// What the chat library's thread views take, restated here because this
// package may not import it. `Thread` is the open row shape of the thread list
// and the sidenav; `ThreadActions` is their row-action adapter; `ChatDirectory`
// is the directory input of the thread sidebar.
type ChatThread = {
  id: string;
  title?: string;
  updatedAt?: number;
  status?: 'active' | 'archived';
  pinned?: boolean;
  projectId?: string | null;
  [key: string]: unknown;
};
interface ChatThreadActions {
  delete?(threadId: string): Promise<void>;
  rename?(threadId: string, newTitle: string): Promise<void>;
  archive?(threadId: string): Promise<void>;
  unarchive?(threadId: string): Promise<void>;
  pin?(threadId: string): Promise<void>;
  unpin?(threadId: string): Promise<void>;
  moveToProject?(threadId: string, projectId: string | null): Promise<void>;
  reorderPinned?(threadId: string, beforeId: string | null): Promise<void>;
}
interface ChatDirectoryError {
  readonly kind: 'connection' | 'auth' | 'server' | 'interrupted' | 'aborted';
  readonly message: string;
  readonly status?: number;
  readonly retryable: boolean;
  readonly recovery?: 'retry' | 'check' | 'none';
  readonly detail?: string;
}
interface ChatDirectory {
  getSnapshot(): {
    readonly threads: readonly ThreadEntry[];
    readonly archived: readonly ThreadEntry[];
    readonly projects?: readonly ProjectEntry[];
    readonly status: ThreadDirectoryStatus;
    readonly error?: ChatDirectoryError;
  };
  subscribe(notify: () => void): () => void;
  refresh(options?: { readonly signal?: AbortSignal }): Promise<void>;
  create?(options?: {
    readonly metadata?: { readonly [key: string]: unknown };
    readonly signal?: AbortSignal;
  }): Promise<{ readonly id: string }>;
  rename?(id: string, title: string): Promise<void>;
  remove?(id: string): Promise<void>;
  setArchived?(id: string, archived: boolean): Promise<void>;
  setPinned?(id: string, pinned: boolean): Promise<void>;
  reorderPinned?(id: string, beforeId: string | null): Promise<void>;
  setProject?(id: string, projectId: string | null): Promise<void>;
  createProject?(name: string): Promise<{ readonly id: string }>;
  renameProject?(id: string, name: string): Promise<void>;
  removeProject?(id: string): Promise<void>;
  dispose(): void;
}

/** The view binds to the chat thread views with no cast and no mapping. */
export function chatBindings(
  view: ThreadDirectoryView,
  full: ThreadDirectoryView<FullDirectory>
) {
  // `[threads]` and `[archivedThreads]` of the sidenav and the thread list.
  const threads: ChatThread[] | null = view.threads();
  const archived: ChatThread[] | null = view.archivedThreads();
  // `[actions]`: the view is the row-action adapter.
  const actions: ChatThreadActions = view;
  const fullActions: ChatThreadActions = full;
  // `[directory]` of the thread sidebar.
  const directory: ChatDirectory = view.directory;
  const fullDirectory: ChatDirectory = full.directory;
  return [threads, archived, actions, fullActions, directory, fullDirectory];
}

/** The run-end helpers take the injected agent, whatever its session. */
export function runEnd(
  agent: Agent,
  langGraph: Agent<LangGraphSession>,
  session: AgentSession,
  view: ThreadDirectoryView
) {
  refreshOnRunEnd(agent, () => view.refresh());
  refreshOnRunEnd(agent, view);
  refreshOnRunEnd(langGraph, view);
  refreshOnRunEnd(agent, view.directory);
  refreshOnRunEnd(agent, () => undefined);
  // @ts-expect-error A session is not an agent: it has no status signal.
  refreshOnRunEnd(session, view);
  // @ts-expect-error What runs at the end is a function or has refresh().
  refreshOnRunEnd(agent, 'refresh');

  const phase = signal<'idle' | 'busy'>('idle');
  refreshOnTransition(phase, (value) => value === 'busy', view);
  refreshOnTransition(
    phase,
    (value) => {
      type Value = Expect<Same<typeof value, 'idle' | 'busy'>>;
      return (value === 'busy') as boolean & Value;
    },
    () => view.refresh()
  );
  // @ts-expect-error The predicate reads the watched signal's own type.
  refreshOnTransition(phase, (value: number) => value > 0, view);
  // @ts-expect-error The first argument is a signal.
  refreshOnTransition('busy', () => true, view);
}
