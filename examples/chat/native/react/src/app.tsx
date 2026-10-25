import { memo, useRef, useState, type ReactNode } from 'react';
import { useAgent } from '@threadplane/react';
import { Markdown } from '@threadplane/react/markdown';
import {
  ChatInput,
  ChatPopup,
  ChatSidebar,
  Citations,
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
import { filterLoadedTitles } from '../../shared/projection';
import { submissionStatus } from '../../shared/submission-status';
import { Approval } from './approval';
import { BackgroundActivity } from './background-activity';
import { CopyAnswer } from './copy-answer';
import { CopyConversationId } from './copy-conversation-id';
import { TripSummary } from './trip-summary';
import { NativeNavigation } from './native-navigation';

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
  return (
    <div className="composer">
      <ChatInput
        id="message"
        label="Message"
        placeholder="Write a message…"
        hint="Ctrl or ⌘ + Enter to send. Enter adds a line."
        submitOnEnter={false}
        disabled={snapshot.selection.status !== 'ready' || active}
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
  const rows = filterLoadedTitles(snapshot.list.rows, filter);
  const selection = snapshot.selection;
  const directory = (
    <aside aria-labelledby="conversations-title">
      <h2 id="conversations-title">Loaded conversations</h2>
      <p className="muted">
        Browse up to 50 loaded conversations. The filter searches only loaded
        titles.
      </p>
      <div className="directory-actions">
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
      <ThreadList
        threads={rows}
        renderActions={(thread) => (
          <CopyConversationId id={thread.id} title={thread.title} />
        )}
        renderTitle={(thread) =>
          renderThreadTitle(thread.title || thread.id, filter)
        }
        activeThreadId={selection.id}
        onSelect={application.select}
        label="Loaded conversations"
        className="conversation-list"
        onNewThread={() => application.newConversation()}
        newThreadDisabled={snapshot.creation.status === 'pending'}
        newThreadLabel="New"
      />
      {snapshot.list.status !== 'pending' && rows.length === 0 && (
        <p className="muted">No loaded conversations match.</p>
      )}
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
      {presentation === 'sidenav' ? (
        <NativeNavigation
          selectedId={selection.id}
          onSearch={() => filterInput.current?.focus()}
          collapsedContent={
            <ThreadList
              threads={rows}
              activeThreadId={selection.id}
              onSelect={application.select}
              label="Loaded conversations"
              className="conversation-list conversation-list--compact"
              renderTitle={(thread) =>
                Array.from(
                  (thread.title || thread.id).trim()
                )[0]?.toUpperCase() || '?'
              }
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
