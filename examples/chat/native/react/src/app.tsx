import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useAgent } from '@threadplane/react';
import { Markdown } from '@threadplane/react/markdown';
import {
  ChatInput,
  ChatPopup,
  ChatSidebar,
  Citations,
  ConfirmDialog,
  MessageList,
  Reasoning,
  ThreadList,
  ToolObservation,
} from '@threadplane/react/chat';
import type {
  ReactApplication as Application,
  ReactApplicationSnapshot as ApplicationSnapshot,
} from './application';
import type { A2uiMessageContent as MessageContent } from './a2ui-message-content';
import { renderThreadTitle } from './thread-title';
import {
  filterLoadedTitles,
  orderActiveThreads,
} from '../../shared/projection';
import type { ThreadRow } from '../../shared/contracts';
import { submissionStatus } from '../../shared/submission-status';
import { Approval } from './approval';
import { BackgroundActivity } from './background-activity';
import { LoadedCheckpointTimeline } from './loaded-checkpoint-timeline';
import { ObservedStateComparison } from './observed-state-comparison';
import { CopyAnswer } from './copy-answer';
import {
  ConversationActions,
  type RenameEditorRequest,
} from './conversation-actions';
import { useConversationMenu } from './use-conversation-menu';
import { TripSummary } from './trip-summary';
import { NativeNavigation } from './native-navigation';
import { CompactThreadRow } from './compact-thread-row';
import { NativeProjects } from './native-projects';
import { useProjectMove } from './use-project-move';
import { useLoadedConversationSearch } from './use-loaded-conversation-search';

type Presentation = 'page' | 'popup' | 'sidebar' | 'sidenav';

const literal = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';

const Message = memo(function Message({ row }: { row: MessageContent }) {
  return (
    <article
      className={`message message-${row.role}`}
      aria-label={`${row.role} message`}
    >
      <h3 className="role-label">{row.role}</h3>
      {row.role === 'assistant' && row.reasoning && (
        <Reasoning snapshot={row.reasoning} />
      )}
      {row.role === 'tool' ? (
        <pre>{row.message.content}</pre>
      ) : (
        <Markdown snapshot={row.markdown} />
      )}
      {row.role === 'assistant' && row.message.citations && (
        <Citations citations={row.message.citations} />
      )}
      {row.role === 'assistant' &&
        row.a2uiTripSummaryRenders.map((prepared) => (
          <TripSummary key={prepared.callId} prepared={prepared} />
        ))}
      {row.role !== 'tool' &&
        row.toolCalls
          .filter(
            (call) => !row.tripSummaries.some((card) => card.callId === call.id)
          )
          .map((call) => (
            <div className="tool-observation" key={call.id}>
              <ToolObservation
                name={call.name}
                argumentsText={literal(call.args)}
                resultText={
                  call.status === 'complete'
                    ? literal(call.result)
                    : call.status === 'error'
                    ? call.error
                    : undefined
                }
              />
              <p className="muted">Observed tool status: {call.status}</p>
            </div>
          ))}
      {row.role === 'assistant' && (
        <CopyAnswer
          text={row.message.content}
          generation={row.message.delivery.generation}
        />
      )}
    </article>
  );
});

const renderMessage = (row: MessageContent) => <Message row={row} />;

function Composer({
  application,
  snapshot,
}: {
  application: Application;
  snapshot: ApplicationSnapshot;
}) {
  const active = snapshot.submission.active;
  const deletionBlocked =
    snapshot.deletion.id === snapshot.selection.id &&
    (snapshot.deletion.status === 'pending' ||
      snapshot.deletion.status === 'unconfirmed');
  return (
    <div className="composer">
      <ChatInput
        id="message"
        label="Message"
        placeholder="Write a message…"
        hint="Ctrl or ⌘ + Enter to send. Enter adds a line."
        submitOnEnter={false}
        disabled={
          snapshot.selection.status !== 'ready' || active || deletionBlocked
        }
        busy={active || !application.canSubmit()}
        onStop={active ? () => void application.stop() : undefined}
        onSubmit={(text) => application.canSubmit() && application.submit(text)}
      />
      <p className="submission-status" role="status">
        {submissionStatus(snapshot)}
      </p>
    </div>
  );
}

function ConversationSurface({
  presentation,
  directory,
  children,
}: {
  presentation: Exclude<Presentation, 'sidenav'>;
  directory?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pushContent, setPushContent] = useState(true);
  if (presentation === 'sidebar') {
    return (
      <ChatSidebar
        open={open}
        onOpenChange={setOpen}
        pushContent={pushContent}
        title="Conversation"
        className="native-conversation-panel"
        pageContent={
          <div className="native-sidebar-page">
            {directory}
            <label className="native-sidebar-preference">
              <input
                type="checkbox"
                checked={pushContent}
                onChange={(event) => setPushContent(event.target.checked)}
                aria-describedby="sidebar-layout-hint"
              />
              <span>Keep page beside chat</span>
            </label>
            <p id="sidebar-layout-hint" className="muted">
              On wide screens, make room for chat beside the page.
            </p>
          </div>
        }
      >
        {children}
      </ChatSidebar>
    );
  }
  return presentation !== 'page' ? (
    <ChatPopup
      open={open}
      onOpenChange={setOpen}
      title="Conversation"
      className="native-conversation-panel"
    >
      {children}
    </ChatPopup>
  ) : (
    <>{children}</>
  );
}

function Conversation({
  application,
  presentation,
}: {
  application: Application;
  presentation: Presentation;
}) {
  const snapshot = useAgent(application);
  const [filter, setFilter] = useState('');
  const filterInput = useRef<HTMLInputElement>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const projectRows = snapshot.list.rows.filter(
    (row) => projectId === null || row.projectId === projectId
  );
  const rows = filterLoadedTitles(projectRows, filter);
  const orderedActiveRows = orderActiveThreads(snapshot.list.rows);
  const pinnedRows = orderedActiveRows.filter((row) => row.pinned === true);
  const activeRows = filterLoadedTitles(
    orderedActiveRows.filter(
      (row) => projectId === null || row.projectId === projectId
    ),
    filter
  );
  const archivedRows = rows.filter((row) => row.archived === true);
  const selection = snapshot.selection;
  const [archiveOpen, setArchiveOpen] = useState(false);
  const search = useLoadedConversationSearch(application, snapshot, (row) => {
    setFilter('');
    setProjectId(null);
    if (row.archived === true) setArchiveOpen(true);
  });
  const menus = useConversationMenu(
    [...activeRows, ...(archiveOpen ? archivedRows : [])].map((row) => ({
      id: row.id,
      occurrenceKey: row.archived === true ? 'archived' : 'active',
    }))
  );
  const reorderRequest = useRef<object | null>(null);
  const [reorderFeedback, setReorderFeedback] = useState<{
    readonly id: string;
    readonly title: string;
    readonly status: 'pending' | 'confirmed' | 'failed';
  } | null>(null);
  const deletionBlocked =
    snapshot.deletion.status === 'pending' ||
    snapshot.deletion.status === 'unconfirmed';
  const deletionTargetBlocked = (id: string) =>
    deletionBlocked && snapshot.deletion.id === id;
  const projectMove = useProjectMove(application, snapshot, filterInput);
  const [confirmation, setConfirmation] = useState<Readonly<{
    id: string;
    title: string;
    selected: boolean;
    token: object;
    returnFocusTo: HTMLElement | null;
  }> | null>(null);
  const confirmationOwner = useRef<typeof confirmation>(null);
  const [deletionFeedback, setDeletionFeedback] = useState<string | null>(null);
  const deletionRequest = useRef<object | null>(null);
  const deletionCheckRequest = useRef<object | null>(null);
  const deletionFocusCleanups = useRef(new Set<() => void>());
  const checkDeletion = (id: string, intent: number, title: string | null) => {
    const operation = {};
    deletionCheckRequest.current = operation;
    void application
      .checkRemoval(id, intent)
      .then((settled) => {
        if (
          !mounted.current ||
          deletionCheckRequest.current !== operation ||
          !settled
        )
          return;
        const latest = application.getSnapshot().deletion;
        if (
          latest.status === 'confirmed' &&
          latest.id === id &&
          latest.intent === intent
        )
          setDeletionFeedback(`Conversation deleted: ${title ?? id} (${id}).`);
        else if (latest.status === 'idle')
          setDeletionFeedback(
            `Conversation still present: ${title ?? id} (${id}).`
          );
      })
      .catch(() => {});
  };
  const requestDeletion = (
    row: ThreadRow,
    returnFocusTo: HTMLElement | null
  ) => {
    if (!application.canRemove(row.id)) return;
    projectMove.dismiss();
    setEditor(null);
    const request = Object.freeze({
      id: row.id,
      title: row.title,
      selected: snapshot.selection.id === row.id,
      token: {},
      returnFocusTo,
    });
    confirmationOwner.current = request;
    setConfirmation(request);
  };
  const closeConfirmation = (request: NonNullable<typeof confirmation>) => {
    if (confirmationOwner.current !== request) return false;
    confirmationOwner.current = null;
    // Commit native modal cleanup/focus restoration before admitting remote I/O.
    flushSync(() => setConfirmation(null));
    return true;
  };
  const confirmDeletion = (request: NonNullable<typeof confirmation>) => {
    if (
      confirmationOwner.current !== request ||
      !application.canRemove(request.id)
    )
      return;
    if (!closeConfirmation(request)) return;
    const operation = {};
    deletionRequest.current = operation;
    setDeletionFeedback(null);
    const target = request.returnFocusTo;
    const doc = target?.ownerDocument;
    let ownsFocus = !!target && doc?.activeElement === target;
    const observeFocus = (event: Event) => {
      if (event.target !== doc?.body) ownsFocus = event.target === target;
    };
    const observePointer = (event: Event) => {
      if (event.target !== target) ownsFocus = false;
    };
    doc?.addEventListener('focusin', observeFocus);
    doc?.addEventListener('pointerdown', observePointer, true);
    const cleanupFocus = () => {
      doc?.removeEventListener('focusin', observeFocus);
      doc?.removeEventListener('pointerdown', observePointer, true);
      deletionFocusCleanups.current.delete(cleanupFocus);
    };
    deletionFocusCleanups.current.add(cleanupFocus);
    void application
      .remove(request.id)
      .then((confirmed) => {
        if (!mounted.current || deletionRequest.current !== operation) return;
        if (confirmed) {
          setDeletionFeedback(
            `Conversation deleted: ${request.title} (${request.id}).`
          );
          // A removed invoker can leave focus on body; only its still-owned focus
          // may move to this directory's stable filter, never a newer destination.
          if (
            ownsFocus &&
            target &&
            doc &&
            !target.isConnected &&
            doc.activeElement === doc.body
          )
            filterInput.current?.focus();
        }
      })
      .catch(() => {})
      .finally(cleanupFocus);
  };
  const reorderBlocked =
    deletionBlocked ||
    snapshot.ordering.status === 'pending' ||
    snapshot.ordering.status === 'unconfirmed';
  const reorderAvailable = application.canReorderPinned() || reorderBlocked;
  const reorder = async (row: ThreadRow, beforeId: string | null) => {
    if (reorderRequest.current || reorderBlocked) return;
    const request = {};
    reorderRequest.current = request;
    setReorderFeedback({ id: row.id, title: row.title, status: 'pending' });
    let confirmed = false;
    try {
      confirmed = await application.reorderPinned(row.id, beforeId);
    } catch {
      /* Optional callbacks may throw as well as reject. */
    }
    if (!mounted.current || reorderRequest.current !== request) return;
    reorderRequest.current = null;
    setReorderFeedback(
      application.getSnapshot().ordering.status === 'unconfirmed'
        ? null
        : {
            id: row.id,
            title: row.title,
            status: confirmed ? 'confirmed' : 'failed',
          }
    );
  };
  const sharedOrdering =
    snapshot.ordering.status === 'pending' ||
    snapshot.ordering.status === 'unconfirmed'
      ? snapshot.ordering
      : null;
  const reorderIdentity = sharedOrdering?.id
    ? `${
        reorderFeedback?.id === sharedOrdering.id
          ? reorderFeedback.title
          : snapshot.list.rows.find((row) => row.id === sharedOrdering.id)
              ?.title || sharedOrdering.id
      } (${sharedOrdering.id})`
    : reorderFeedback
    ? `${reorderFeedback.title} (${reorderFeedback.id})`
    : '';
  const archiveRequests = useRef(new Map<string, object>());
  const mounted = useRef(false);
  const [archiveFeedback, setArchiveFeedback] = useState<
    Readonly<
      Record<
        string,
        {
          readonly title: string;
          readonly archived: boolean;
          readonly status: 'pending' | 'confirmed' | 'failed';
        }
      >
    >
  >({});
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      archiveRequests.current.clear();
      reorderRequest.current = null;
      confirmationOwner.current = null;
      deletionRequest.current = null;
      deletionCheckRequest.current = null;
      for (const cleanup of deletionFocusCleanups.current) cleanup();
    };
  }, []);
  const archive = async (row: ThreadRow) => {
    if (
      archiveRequests.current.has(row.id) ||
      snapshot.archives[row.id]?.status === 'pending'
    )
      return;
    const request = {};
    const archived = row.archived !== true;
    archiveRequests.current.set(row.id, request);
    setArchiveFeedback((latest) => ({
      ...latest,
      [row.id]: { title: row.title, archived, status: 'pending' },
    }));
    let confirmed = false;
    try {
      confirmed = await application.setArchived(row.id, archived);
    } catch {
      /* Optional commands may reject. */
    }
    if (!mounted.current || archiveRequests.current.get(row.id) !== request)
      return;
    archiveRequests.current.delete(row.id);
    setArchiveFeedback((latest) => ({
      ...latest,
      [row.id]: {
        title: row.title,
        archived,
        status: confirmed ? 'confirmed' : 'failed',
      },
    }));
  };
  // Only live pending state is shared across UI occurrences. Settled feedback
  // belongs to commands started by this mounted directory, never replayed history.
  const feedback = { ...archiveFeedback };
  for (const [id, state] of Object.entries(snapshot.archives)) {
    if (state.status === 'pending')
      feedback[id] = {
        ...state,
        title:
          archiveFeedback[id]?.title ??
          snapshot.list.rows.find((row) => row.id === id)?.title ??
          id,
      };
  }
  const [editor, setEditor] = useState<RenameEditorRequest | null>(null);
  const editorSequence = useRef(0);
  useEffect(() => {
    if (editor && !activeRows.some((row) => row.id === editor.id))
      setEditor((latest) => (latest === editor ? null : latest));
  }, [activeRows, editor]);
  const renderActions = (thread: {
    readonly id: string;
    readonly title?: string;
    readonly pinned?: boolean;
  }) => (
    <ConversationActions
      id={thread.id}
      archived={
        snapshot.list.rows.find((row) => row.id === thread.id)?.archived
      }
      archivePending={snapshot.archives[thread.id]?.status === 'pending'}
      mutationBlocked={deletionTargetBlocked(thread.id)}
      onDelete={
        application.hasRemovalCapability()
          ? (target) => {
              const row = snapshot.list.rows.find(
                (row) => row.id === thread.id
              );
              if (row) requestDeletion(row, target);
            }
          : undefined
      }
      deleteDisabled={!application.canRemove(thread.id)}
      deleteReason={
        application.hasRemovalCapability() &&
        snapshot.selection.id === thread.id &&
        (snapshot.submission.active ||
          snapshot.runtime?.status === 'running' ||
          !!snapshot.runtime?.reconnect?.runId)
          ? 'Resolve the current run before deleting this conversation.'
          : undefined
      }
      reorderPending={reorderBlocked}
      onMoveUp={
        reorderAvailable &&
        pinnedRows.findIndex((row) => row.id === thread.id) > 0
          ? () => {
              const index = pinnedRows.findIndex((row) => row.id === thread.id);
              void reorder(pinnedRows[index], pinnedRows[index - 1].id);
            }
          : undefined
      }
      onMoveDown={
        reorderAvailable &&
        pinnedRows.some(
          (row, index) => row.id === thread.id && index < pinnedRows.length - 1
        )
          ? () => {
              const index = pinnedRows.findIndex((row) => row.id === thread.id);
              void reorder(
                pinnedRows[index],
                pinnedRows[index + 2]?.id ?? null
              );
            }
          : undefined
      }
      onArchive={
        application.canSetArchived()
          ? () => {
              const row = snapshot.list.rows.find(
                (row) => row.id === thread.id
              );
              if (row) void archive(row);
            }
          : undefined
      }
      title={thread.title ?? ''}
      menu={{
        ...menus.forThread(thread.id),
        onOpenChange(open) {
          if (open) projectMove.dismiss();
          menus.forThread(thread.id).onOpenChange(open);
        },
      }}
      onMoveProject={
        application.canSetProject?.()
          ? (target) => {
              const row = snapshot.list.rows.find(
                (row) => row.id === thread.id
              );
              if (row) {
                setEditor(null);
                projectMove.requestMove(row, target);
              }
            }
          : undefined
      }
      moveProjectPending={
        snapshot.projectMoves?.[thread.id]?.status === 'pending'
      }
      canRename={application.canRename()}
      canSetPinned={application.canSetPinned()}
      pinned={thread.pinned}
      pinState={snapshot.pins[thread.id]}
      setPinned={application.setPinned}
      pending={snapshot.renames[thread.id]?.status === 'pending'}
      rename={application.rename}
      editor={rows.some((row) => row.id === editor?.id) ? editor : null}
      onRename={(target) => {
        projectMove.dismiss();
        setEditor({
          id: thread.id,
          token: ++editorSequence.current,
          returnFocusTo: target,
        });
      }}
      onClose={(request) =>
        setEditor((latest) => (latest === request ? null : latest))
      }
    />
  );
  const directory = (
    <aside aria-labelledby="conversations-title">
      <h2 id="conversations-title">Loaded conversations</h2>
      <p className="muted">
        Browse up to 50 loaded conversations. The filter searches only loaded
        titles. Pinned conversations appear first. Moves apply to all loaded
        pinned conversations, including those hidden by the title or project
        filter.
      </p>
      <NativeProjects
        deletion={application}
        rows={snapshot.list.rows}
        projectId={projectId}
        onSelect={setProjectId}
      />
      <div className="directory-actions">
        {presentation !== 'sidenav' && (
          <button type="button" onClick={search.openSearch}>
            Search loaded conversations
          </button>
        )}
        <button
          type="button"
          onClick={() => application.refresh()}
          disabled={snapshot.list.status === 'pending'}
        >
          Refresh
        </button>
      </div>
      <label htmlFor="filter">Filter loaded conversations by title</label>
      <input
        ref={filterInput}
        id="filter"
        type="search"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      {projectMove.editor}
      {projectMove.feedback}
      {snapshot.list.status === 'pending' && (
        <p role="status">Refreshing conversations…</p>
      )}
      {snapshot.list.status === 'error' && (
        <p role="alert">Could not refresh loaded conversations.</p>
      )}
      {snapshot.creation.status === 'pending' && (
        <p role="status">Creating conversation…</p>
      )}
      {snapshot.creation.status === 'unconfirmed' && (
        <p role="alert">
          Creation could not be confirmed. A conversation may have been created;
          refresh before trying again.
        </p>
      )}
      {deletionBlocked && (
        <div className="conversation-delete-feedback">
          <p role="status">
            {snapshot.deletion.status === 'pending'
              ? `Deleting conversation ${snapshot.deletion.title} (${snapshot.deletion.id})…`
              : snapshot.deletion.checking
              ? `Checking deletion status for ${snapshot.deletion.title} (${snapshot.deletion.id})…`
              : `Conversation deletion unconfirmed for ${snapshot.deletion.title} (${snapshot.deletion.id}). Check its status before deleting again.`}
          </p>
          {snapshot.deletion.status === 'unconfirmed' && (
            <button
              type="button"
              disabled={snapshot.deletion.checking}
              onClick={() => {
                const { id, intent, title } = snapshot.deletion;
                if (id) checkDeletion(id, intent, title);
              }}
            >
              {snapshot.deletion.checking
                ? 'Checking deletion status…'
                : 'Check deletion status'}
            </button>
          )}
        </div>
      )}
      {!deletionBlocked && deletionFeedback && (
        <p role="status">{deletionFeedback}</p>
      )}
      {(sharedOrdering || reorderFeedback) && (
        <p role="status" className="conversation-order-feedback">
          {sharedOrdering?.status === 'unconfirmed'
            ? `Conversation order unconfirmed for ${reorderIdentity}. Refresh before reordering again.`
            : sharedOrdering?.status === 'pending' ||
              reorderFeedback?.status === 'pending'
            ? `Moving conversation ${reorderIdentity}…`
            : reorderFeedback?.status === 'confirmed'
            ? `Moved conversation ${reorderIdentity}.`
            : `Could not move conversation ${reorderIdentity}. Try again.`}
        </p>
      )}
      <ThreadList
        threads={activeRows}
        onContextMenu={(id, event) => {
          setEditor(null);
          projectMove.dismiss();
          menus.onContextMenu(id, event);
        }}
        renderActions={renderActions}
        renderTitle={(thread) =>
          renderThreadTitle(thread.title || thread.id, filter)
        }
        activeThreadId={selection.id}
        onSelect={application.select}
        label="Loaded conversations"
        className="conversation-list"
        onNewThread={() => application.newConversation(projectId)}
        newThreadDisabled={
          snapshot.creation.status === 'pending' ||
          snapshot.projectDeletion?.status === 'pending' ||
          ((snapshot.projectDeletion?.status === 'unconfirmed' ||
            snapshot.projectDeletion?.status === 'confirmed') &&
            snapshot.projectDeletion.id === projectId)
        }
        newThreadLabel="New"
      />
      {snapshot.list.status !== 'pending' && activeRows.length === 0 && (
        <p className="muted">No loaded conversations match.</p>
      )}
      <details
        className="archived-conversations"
        open={archiveOpen}
        onToggle={(event) => setArchiveOpen(event.currentTarget.open)}
      >
        <summary>Archived conversations</summary>
        <p className="muted">
          Archived conversations among the loaded rows. The same title filter
          applies.
        </p>
        <ThreadList
          threads={archivedRows}
          onContextMenu={(id, event) => {
            setEditor(null);
            projectMove.dismiss();
            menus.onContextMenu(id, event);
          }}
          renderActions={renderActions}
          renderTitle={(thread) =>
            renderThreadTitle(thread.title || thread.id, filter)
          }
          activeThreadId={selection.id}
          onSelect={application.select}
          label="Archived loaded conversations"
          className="conversation-list"
        />
        {snapshot.list.status !== 'pending' && archivedRows.length === 0 && (
          <p className="muted">No archived loaded conversations match.</p>
        )}
      </details>
      <div className="conversation-archive-feedback">
        {Object.entries(feedback).map(([id, state]) => (
          <p key={id} role="status">
            {state.status === 'pending'
              ? `${state.archived ? 'Archiving' : 'Unarchiving'} conversation`
              : state.status === 'confirmed'
              ? `Conversation ${state.archived ? 'archived' : 'unarchived'}`
              : `Could not ${
                  state.archived ? 'archive' : 'unarchive'
                } conversation. Try again.`}
            {` ${state.title} (${id})`}
          </p>
        ))}
      </div>
    </aside>
  );
  return (
    <div
      className={`conversation-layout${
        presentation === 'sidenav'
          ? ' conversation-layout--sidenav'
          : presentation === 'sidebar'
          ? ' conversation-layout--sidebar'
          : ''
      }`}
    >
      {search.palette}
      <ConfirmDialog
        open={confirmation !== null}
        title="Delete conversation?"
        body={
          confirmation
            ? `Permanently delete ${confirmation.title} (${
                confirmation.id
              })? This action is permanent.${
                confirmation.selected
                  ? ' This closes the selected conversation and discards its draft.'
                  : ''
              }`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        tone="destructive"
        returnFocusTo={confirmation?.returnFocusTo}
        onConfirm={() => {
          if (confirmation) confirmDeletion(confirmation);
        }}
        onCancel={() => {
          if (confirmation) closeConfirmation(confirmation);
        }}
      />
      {presentation === 'sidenav' ? (
        <NativeNavigation
          selectedId={selection.id}
          onSearch={search.openSearch}
          collapsedContent={
            <ThreadList
              threads={activeRows}
              activeThreadId={selection.id}
              onSelect={application.select}
              label="Loaded conversations"
              className="conversation-list conversation-list--compact"
              renderItem={(thread, active) => (
                <CompactThreadRow
                  thread={thread}
                  active={active}
                  onSelect={application.select}
                />
              )}
            />
          }
        >
          {directory}
        </NativeNavigation>
      ) : presentation !== 'sidebar' ? (
        directory
      ) : null}
      <ConversationSurface
        presentation={presentation === 'sidenav' ? 'page' : presentation}
        directory={presentation === 'sidebar' ? directory : undefined}
      >
        <section className="conversation" aria-labelledby="conversation-title">
          <div className="conversation-heading">
            <p className="eyebrow">React example</p>
            <h1 id="conversation-title">
              {selection.row?.title ?? 'Your conversation'}
            </h1>
            {selection.id && (
              <p className="conversation-id muted">
                Conversation ID: {selection.id}
              </p>
            )}
          </div>
          {selection.status === 'empty' && (
            <div className="empty-state">
              <h2>A place for your next conversation.</h2>
              <p>Select a conversation or start a new one.</p>
            </div>
          )}
          {selection.status === 'pending' && (
            <p role="status">Loading conversation…</p>
          )}
          {(selection.status === 'missing' || selection.status === 'error') && (
            <div className="selection-error">
              <p role="alert">
                {selection.status === 'missing'
                  ? 'Conversation not found.'
                  : 'Could not load this conversation.'}
              </p>
              <button type="button" onClick={() => application.retry()}>
                Retry
              </button>
            </div>
          )}
          {selection.status === 'ready' && (
            <>
              <MessageList
                key={selection.id}
                rows={snapshot.messages}
                renderMessage={renderMessage}
                label="Conversation messages"
                className="transcript"
              />
              {snapshot.messages.length === 0 && (
                <p className="empty-state">
                  This conversation has no messages yet.
                </p>
              )}
              <BackgroundActivity
                observations={snapshot.runtime?.subgraphs ?? []}
              />
              <LoadedCheckpointTimeline
                key={`timeline:${selection.id}`}
                application={application}
                threadId={selection.id ?? ''}
                page={snapshot.runtime?.history}
              />
              <ObservedStateComparison
                key={`state-comparison:${selection.id}`}
                application={application}
                threadId={selection.id ?? ''}
                values={snapshot.runtime?.values}
              />
            </>
          )}
          <Approval application={application} snapshot={snapshot} />
          <Composer
            key={selection.id}
            application={application}
            snapshot={snapshot}
          />
        </section>
      </ConversationSurface>
    </div>
  );
}

export function App({
  application,
  presentation = 'page',
}: {
  application: Application | null;
  presentation?: Presentation;
}) {
  return (
    <div className="application">
      <header>
        <span className="brand-mark" aria-hidden="true" />
        Threadplane<span className="example-label">Native conversation</span>
      </header>
      <main>
        {application ? (
          <Conversation application={application} presentation={presentation} />
        ) : (
          <section className="setup" role="status">
            <h1>Set up an assistant to begin</h1>
            <p>
              This example is not connected to an assistant yet. Configure an
              assistant before starting a conversation.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
