'use client';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  refreshDirectoryOnRunEnd,
  type AgentSession,
  type ThreadDirectory,
  type ThreadDirectorySnapshot,
  type ThreadEntry,
} from '@threadplane/core';
import { ChatSidenavSections } from './chat-sidenav-sections.js';
import type { ProjectActionAdapter } from './project-list.js';
import type { ThreadActionAdapter, ThreadListProps } from './thread-list.js';

/**
 * Built-in sidebar features. Each defaults to on when the directory supports
 * it; `false` turns it off even when the directory could perform it.
 */
export interface ThreadSidebarFeatures {
  /** The Projects section, project commands and Move to project. */
  readonly projects?: boolean;
  /** The Archived section and Archive and Unarchive. */
  readonly archive?: boolean;
  readonly pin?: boolean;
  readonly reorder?: boolean;
  readonly rename?: boolean;
  readonly remove?: boolean;
}

/** A thread directory with selection callbacks, feature switches, row slots and labels. */
export interface ThreadSidebarProps {
  /** App-owned; the sidebar never disposes it. */
  readonly directory: ThreadDirectory;
  /** Refreshes the directory each time a run ends. */
  readonly session?: Pick<AgentSession, 'getSnapshot' | 'subscribe'>;
  readonly activeThreadId?: string | null;
  readonly onSelect: (threadId: string) => void;
  /** Replaces the default New chat, which creates a thread and selects it. */
  readonly onNewChat?: () => void;
  /** Called after the active thread is deleted. */
  readonly onActiveRemoved?: () => void;
  /**
   * When a project id, Recent and Archived list only that project's threads;
   * `null` or omitted lists every thread.
   */
  readonly selectedProjectId?: string | null;
  /** Called with the project the user picked; the app owns `selectedProjectId`. */
  readonly onProjectSelect?: (projectId: string | null) => void;
  readonly features?: ThreadSidebarFeatures;
  /** Replaces each conversation row; see `ThreadListProps.renderItem`. */
  readonly renderThread?: ThreadListProps['renderItem'];
  /** App commands appended to each conversation row menu. */
  readonly extraActions?: ThreadListProps['extraActions'];
  /** App content before the built-in sections. */
  readonly before?: ReactNode;
  /** App content after the built-in sections. */
  readonly after?: ReactNode;
  readonly labels?: Partial<
    Record<
      | 'newChat'
      | 'projects'
      | 'recent'
      | 'archived'
      | 'archivedEmpty'
      | 'loadError'
      | 'retry'
      | 'empty',
      string
    >
  >;
  readonly className?: string;
}

const ignore = () => undefined;
const NO_FEATURES: ThreadSidebarFeatures = {};

/**
 * The entries in `projectId`, or all of them when no project is selected or
 * the selected project is not in `projects` (deleted, or the Store is
 * unavailable), so a stale selection never hides every conversation.
 */
function inProject(
  entries: readonly ThreadEntry[],
  projectId: string | null | undefined,
  projects: ThreadDirectorySnapshot['projects']
): readonly ThreadEntry[] {
  return typeof projectId === 'string' &&
    projects?.some((project) => project.id === projectId)
    ? entries.filter((entry) => entry.projectId === projectId)
    : entries;
}

/**
 * A conversation sidebar connected to a `ThreadDirectory`: New chat,
 * Projects, Recent and Archived with the row commands the directory supports.
 * It refreshes on mount and, given a session, after each run. Place it inside
 * `ChatSidenav` or use it on its own.
 */
export function ThreadSidebar({
  directory,
  session,
  activeThreadId,
  onSelect,
  onNewChat,
  onActiveRemoved,
  selectedProjectId,
  onProjectSelect,
  features = NO_FEATURES,
  renderThread,
  extraActions,
  before,
  after,
  labels,
  className,
}: ThreadSidebarProps) {
  const subscribe = useCallback(
    (notify: () => void) => directory.subscribe(notify),
    [directory]
  );
  const getSnapshot = useCallback(() => directory.getSnapshot(), [directory]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Handlers read the latest props without resubscribing.
  const latest = useRef({
    activeThreadId,
    onSelect,
    onActiveRemoved,
    selectedProjectId,
    onProjectSelect,
  });
  latest.current = {
    activeThreadId,
    onSelect,
    onActiveRemoved,
    selectedProjectId,
    onProjectSelect,
  };

  // Until the mount refresh settles, an empty list means "not loaded yet",
  // so the empty label waits for it.
  const [settled, setSettled] = useState<ThreadDirectory | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    directory
      .refresh({ signal: controller.signal })
      .catch(ignore)
      .then(() => {
        if (!controller.signal.aborted) setSettled(directory);
      });
    return () => controller.abort();
  }, [directory]);

  useEffect(() => {
    if (!session) return undefined;
    return refreshDirectoryOnRunEnd(
      { refresh: () => directory.refresh().catch(ignore) },
      session
    );
  }, [directory, session]);

  const on = (feature: keyof ThreadSidebarFeatures) =>
    features[feature] !== false;
  const showProjects = on('projects') && snapshot.projects !== undefined;
  const showArchive = on('archive');

  const {
    rename,
    remove,
    setArchived,
    setPinned,
    reorderPinned,
    setProject,
    createProject,
    renameProject,
    removeProject,
    create,
  } = directory;
  const threadActions: ThreadActionAdapter = {
    rename:
      rename && on('rename')
        ? (id, title) => rename.call(directory, id, title)
        : undefined,
    delete:
      remove && on('remove')
        ? async (id) => {
            const wasActive = id === latest.current.activeThreadId;
            await remove.call(directory, id);
            if (wasActive) latest.current.onActiveRemoved?.();
          }
        : undefined,
    archive:
      setArchived && showArchive
        ? (id) => setArchived.call(directory, id, true)
        : undefined,
    unarchive:
      setArchived && showArchive
        ? (id) => setArchived.call(directory, id, false)
        : undefined,
    pin:
      setPinned && on('pin')
        ? (id) => setPinned.call(directory, id, true)
        : undefined,
    unpin:
      setPinned && on('pin')
        ? (id) => setPinned.call(directory, id, false)
        : undefined,
    reorderPinned:
      reorderPinned && on('reorder')
        ? (id, beforeId) => reorderPinned.call(directory, id, beforeId)
        : undefined,
    moveToProject:
      setProject && showProjects
        ? (id, projectId) => setProject.call(directory, id, projectId)
        : undefined,
  };
  const projectActions: ProjectActionAdapter | null = showProjects
    ? {
        create: createProject
          ? (name) => createProject.call(directory, name)
          : undefined,
        rename: renameProject
          ? (id, name) => renameProject.call(directory, id, name)
          : undefined,
        delete: removeProject
          ? async (id) => {
              const wasSelected = id === latest.current.selectedProjectId;
              await removeProject.call(directory, id);
              if (wasSelected) latest.current.onProjectSelect?.(null);
            }
          : undefined,
      }
    : null;
  const newChat =
    onNewChat ??
    (create
      ? () => {
          create
            .call(directory)
            .then(({ id }) => latest.current.onSelect(id))
            .catch(ignore);
        }
      : undefined);

  const threads = useMemo(
    () => inProject(snapshot.threads, selectedProjectId, snapshot.projects),
    [snapshot.threads, snapshot.projects, selectedProjectId]
  );
  const archived = useMemo(
    () => inProject(snapshot.archived, selectedProjectId, snapshot.projects),
    [snapshot.archived, snapshot.projects, selectedProjectId]
  );

  const loading = snapshot.status === 'loading' || settled !== directory;
  const failed = snapshot.status === 'error';
  return (
    <div
      className={['tp-thread-sidebar', className].filter(Boolean).join(' ')}
      aria-busy={loading ? true : undefined}
    >
      {before}
      {failed && (
        <div role="alert" className="tp-chat-error tp-thread-sidebar__error">
          <p className="tp-chat-error__message">
            {labels?.loadError ?? 'Could not load conversations.'}
          </p>
          <button
            type="button"
            onClick={() => {
              directory.refresh().catch(ignore);
            }}
          >
            {labels?.retry ?? 'Retry'}
          </button>
        </div>
      )}
      <ChatSidenavSections
        onNewChat={newChat}
        threads={threads}
        archivedThreads={showArchive ? archived : null}
        activeThreadId={activeThreadId}
        onThreadSelect={onSelect}
        threadActions={threadActions}
        renderThread={renderThread}
        extraThreadActions={extraActions}
        projects={showProjects ? snapshot.projects : null}
        selectedProjectId={selectedProjectId}
        onProjectSelect={onProjectSelect}
        projectActions={projectActions}
        newChatLabel={labels?.newChat}
        projectsLabel={labels?.projects}
        recentLabel={labels?.recent}
        archivedLabel={labels?.archived}
        archivedEmptyLabel={labels?.archivedEmpty}
        recentEmptyLabel={
          loading || failed
            ? undefined
            : labels?.empty ?? 'No conversations yet.'
        }
      />
      {after}
    </div>
  );
}
