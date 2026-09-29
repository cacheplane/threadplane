import { memo, useState } from 'react';
import { useAgent } from '@threadplane/react';
import { Markdown } from '@threadplane/react/markdown';
import { ToolObservation } from '@threadplane/react/chat';
import type { CompleteOutcome } from '@threadplane/core';
import type {
  createApplication,
  ApplicationSnapshot,
} from '../../shared/application';
import type { MessageContent } from '../../shared/message-content';
import { filterLoadedTitles } from '../../shared/projection';

type Application = ReturnType<typeof createApplication>;
const outcomes: Record<CompleteOutcome, string> = {
  success: 'Response complete.',
  error: 'The response failed. You can send another message.',
  aborted: 'Response stopped locally. The server may still be running.',
  interrupted: 'Response interrupted before completion.',
  paused: 'Response paused. This example cannot resume it.',
};
const literal = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';

const Message = memo(function Message({ row }: { row: MessageContent }) {
  return (
    <article
      className={`message message-${row.role}`}
      aria-label={`${row.role} message`}
    >
      <h3 className="role-label">{row.role}</h3>
      {row.role === 'tool' ? (
        <pre>{row.message.content}</pre>
      ) : (
        <Markdown snapshot={row.markdown} />
      )}
      {row.role !== 'tool' &&
        row.toolCalls.map((call) => (
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
    </article>
  );
});

function Composer({
  application,
  snapshot,
}: {
  application: Application;
  snapshot: ApplicationSnapshot;
}) {
  const [draft, setDraft] = useState('');
  const enabled = application.canSubmit();
  const send = () => {
    if (application.submit(draft)) setDraft('');
  };
  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <label htmlFor="message">Message</label>
      <textarea
        id="message"
        value={draft}
        disabled={!enabled}
        rows={3}
        placeholder="Write a message…"
        aria-describedby="composer-help"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            (event.ctrlKey || event.metaKey) &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            send();
          }
        }}
      />
      <div className="composer-actions">
        <p id="composer-help" className="muted">
          Ctrl or ⌘ + Enter to send. Enter adds a line.
        </p>
        {snapshot.submission.active && (
          <button type="button" onClick={() => application.stop()}>
            Stop
          </button>
        )}
        <button
          className="primary"
          type="submit"
          disabled={!enabled || !draft.trim()}
        >
          Send
        </button>
      </div>
      <p className="submission-status" role="status">
        {snapshot.submission.active
          ? 'Response in progress…'
          : snapshot.submission.outcome
          ? outcomes[snapshot.submission.outcome]
          : ''}
      </p>
    </form>
  );
}

function Conversation({ application }: { application: Application }) {
  const snapshot = useAgent(application);
  const [filter, setFilter] = useState('');
  const rows = filterLoadedTitles(snapshot.list.rows, filter);
  const selection = snapshot.selection;
  return (
    <div className="conversation-layout">
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
          <button
            type="button"
            onClick={() => application.newConversation()}
            disabled={snapshot.creation.status === 'pending'}
          >
            New
          </button>
        </div>
        <label htmlFor="filter">Filter loaded conversations by title</label>
        <input
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
            Creation could not be confirmed. A conversation may have been
            created; refresh before trying again.
          </p>
        )}
        <ul className="conversation-list" aria-label="Loaded conversations">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                aria-current={row.id === selection.id ? 'true' : undefined}
                onClick={() => application.select(row.id)}
              >
                {row.title}
              </button>
            </li>
          ))}
        </ul>
        {snapshot.list.status !== 'pending' && rows.length === 0 && (
          <p className="muted">No loaded conversations match.</p>
        )}
      </aside>
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
          <div
            className="transcript"
            role="region"
            aria-label="Conversation messages"
          >
            {snapshot.messages.length ? (
              snapshot.messages.map((row) => <Message key={row.id} row={row} />)
            ) : (
              <p className="empty-state">
                This conversation has no messages yet.
              </p>
            )}
          </div>
        )}
        <Composer
          key={selection.id}
          application={application}
          snapshot={snapshot}
        />
      </section>
    </div>
  );
}

export function App({ application }: { application: Application | null }) {
  return (
    <div className="application">
      <header>
        <span className="brand-mark" aria-hidden="true" />
        Threadplane<span className="example-label">Native conversation</span>
      </header>
      <main>
        {application ? (
          <Conversation application={application} />
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
