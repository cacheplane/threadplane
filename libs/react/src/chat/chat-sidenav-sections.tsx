'use client';
import { useId, useState, type ReactNode } from 'react';
import {
  ProjectList,
  type ProjectActionAdapter,
  type ProjectListItem,
} from './project-list.js';
import {
  ThreadList,
  type ThreadActionAdapter,
  type ThreadListItem,
  type ThreadListProps,
} from './thread-list.js';

/** Supplies the conversations, archived conversations and projects a sidebar shows, with their selection callbacks and row actions. */
export interface ChatSidenavSectionsProps {
  /** Starts a new conversation; adds the "New chat" button. */
  readonly onNewChat?: () => void;
  /** Active conversations, listed under "Recent". Null or absent omits the section. */
  readonly threads?: readonly ThreadListItem[] | null;
  /** Archived conversations in a collapsed "Archived" section. Null or absent omits it. */
  readonly archivedThreads?: readonly ThreadListItem[] | null;
  readonly activeThreadId?: string | null;
  /** Required for conversations to be selectable. */
  readonly onThreadSelect?: (threadId: string) => void;
  /** Row actions for both conversation lists; see `ThreadListProps.actions`. */
  readonly threadActions?: ThreadActionAdapter | null;
  /** Replaces each conversation row in both lists; see `ThreadListProps.renderItem`. */
  readonly renderThread?: ThreadListProps['renderItem'];
  /** App commands appended to each conversation row menu; see `ThreadListProps.extraActions`. */
  readonly extraThreadActions?: ThreadListProps['extraActions'];
  /** Projects, listed under "Projects" and offered as move destinations. Null or absent omits the section. */
  readonly projects?: readonly ProjectListItem[] | null;
  readonly selectedProjectId?: string | null;
  readonly onProjectSelect?: (projectId: string) => void;
  /** Row actions for projects; `create` adds "+ New project". See `ProjectListProps.actions`. */
  readonly projectActions?: ProjectActionAdapter | null;
  /** The reference time for relative update times; see `ThreadListProps.now`. */
  readonly now?: number;
  /** App-owned content after the built-in sections. */
  readonly children?: ReactNode;
  readonly className?: string;
  readonly newChatLabel?: string;
  readonly projectsLabel?: string;
  readonly recentLabel?: string;
  readonly archivedLabel?: string;
  readonly archivedEmptyLabel?: string;
  /** Shown under "Recent" in place of an empty list. Absent keeps the empty list. */
  readonly recentEmptyLabel?: string;
}

const ignore = () => undefined;

/**
 * The usual sidebar content: New chat, Projects, Recent and a collapsed
 * Archived section. Place it inside `ChatSidenav`, which supplies the shell,
 * search and collapse. Every list is controlled: the app owns the data and
 * what selecting or acting on a row does.
 */
export function ChatSidenavSections({
  onNewChat,
  threads,
  archivedThreads,
  activeThreadId,
  onThreadSelect = ignore,
  threadActions,
  renderThread,
  extraThreadActions,
  projects,
  selectedProjectId,
  onProjectSelect = ignore,
  projectActions,
  now,
  children,
  className,
  newChatLabel = 'New chat',
  projectsLabel = 'Projects',
  recentLabel = 'Recent',
  archivedLabel = 'Archived',
  archivedEmptyLabel = 'No archived conversations.',
  recentEmptyLabel,
}: ChatSidenavSectionsProps) {
  const id = useId();
  const [archivedOpen, setArchivedOpen] = useState(false);
  const destinations = projects ?? undefined;
  return (
    <div
      className={['tp-chat-sidenav-sections', className]
        .filter(Boolean)
        .join(' ')}
    >
      {onNewChat && (
        <button
          type="button"
          className="tp-chat-sidenav-sections__new"
          onClick={() => onNewChat()}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          {newChatLabel}
        </button>
      )}
      {projects != null && (
        <section
          className="tp-chat-sidenav-sections__section"
          aria-labelledby={`${id}-projects`}
        >
          <h2
            id={`${id}-projects`}
            className="tp-chat-sidenav-sections__heading"
          >
            {projectsLabel}
          </h2>
          <ProjectList
            label={projectsLabel}
            projects={projects}
            activeProjectId={selectedProjectId}
            onSelect={onProjectSelect}
            actions={projectActions}
          />
        </section>
      )}
      {threads != null && (
        <section
          className="tp-chat-sidenav-sections__section"
          aria-labelledby={`${id}-recent`}
        >
          <h2 id={`${id}-recent`} className="tp-chat-sidenav-sections__heading">
            {recentLabel}
          </h2>
          {threads.length === 0 && recentEmptyLabel !== undefined ? (
            <p className="tp-chat-sidenav-sections__empty">
              {recentEmptyLabel}
            </p>
          ) : (
            <ThreadList
              label={recentLabel}
              threads={threads}
              activeThreadId={activeThreadId}
              onSelect={onThreadSelect}
              actions={threadActions}
              projects={destinations}
              now={now}
              renderItem={renderThread}
              extraActions={extraThreadActions}
            />
          )}
        </section>
      )}
      {archivedThreads != null && (
        <section
          className="tp-chat-sidenav-sections__section tp-chat-sidenav-sections__archived"
          data-open={archivedOpen ? '' : undefined}
        >
          <h2 className="tp-chat-sidenav-sections__archived-heading">
            <button
              type="button"
              className="tp-chat-sidenav-sections__archived-toggle"
              aria-expanded={archivedOpen}
              aria-controls={`${id}-archived`}
              onClick={() => setArchivedOpen((open) => !open)}
            >
              <svg
                className="tp-chat-sidenav-sections__chevron"
                viewBox="0 0 24 24"
                width="12"
                height="12"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
              {archivedLabel}
            </button>
          </h2>
          <div id={`${id}-archived`} hidden={!archivedOpen}>
            {!archivedOpen ? null : archivedThreads.length === 0 ? (
              <p className="tp-chat-sidenav-sections__empty">
                {archivedEmptyLabel}
              </p>
            ) : (
              <ThreadList
                mode="archived"
                label={archivedLabel}
                threads={archivedThreads}
                activeThreadId={activeThreadId}
                onSelect={onThreadSelect}
                actions={threadActions}
                projects={destinations}
                now={now}
                renderItem={renderThread}
                extraActions={extraThreadActions}
              />
            )}
          </div>
        </section>
      )}
      {children}
    </div>
  );
}
