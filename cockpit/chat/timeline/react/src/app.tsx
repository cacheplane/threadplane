import { useEffect, useRef, useState } from 'react';
import { useAgent } from '@threadplane/react';
import {
  ChatInput,
  MessageList,
  Reasoning,
  Citations,
} from '@threadplane/react/chat';
import { Markdown } from '@threadplane/react/markdown';
import type { MessageRow } from '@threadplane/content/messages';
import { createTimelineClient, type TimelineConnection } from './connection';
import { createTimelineApplication } from './application';

/** Content stores stay with their current or preview owner. */
export function renderMessage(row: MessageRow) {
  const label = row.role === 'user' ? 'You' : 'Assistant';
  return (
    <article
      aria-label={label}
      className={`tp-chat-message tp-chat-message--${row.role}`}
    >
      <p className="tp-chat-message__role">{label}</p>
      {row.role === 'assistant' && row.reasoning && (
        <Reasoning snapshot={row.reasoning} />
      )}
      <Markdown snapshot={row.markdown} />
      {row.role === 'assistant' && row.message.citations && (
        <Citations citations={row.message.citations} />
      )}
    </article>
  );
}
type Props = {
  readonly connection: TimelineConnection;
  readonly onReady: () => void;
};
/** Configuration changes replace the entire owner; credentials never become React keys. */
export function TimelineDemo(props: Props) {
  const fingerprint = JSON.stringify([
    props.connection.apiUrl,
    Object.entries(props.connection.headers).sort(([a], [b]) =>
      a.localeCompare(b)
    ),
  ]);
  const identity = useRef({ fingerprint, version: 0 });
  if (identity.current.fingerprint !== fingerprint)
    identity.current = { fingerprint, version: identity.current.version + 1 };
  return <TimelineOwner key={identity.current.version} {...props} />;
}
function TimelineOwner({ connection, onReady }: Props) {
  const [application] = useState(() =>
    createTimelineApplication(createTimelineClient(connection))
  );
  const snapshot = useAgent(application);
  useEffect(() => {
    onReady();
  }, [onReady]);
  useEffect(
    () => () => {
      void application.dispose();
    },
    [application]
  );
  const currentView = () =>
    application.getSnapshot().viewGeneration === snapshot.viewGeneration;
  const status = snapshot.busy
    ? snapshot.activity === 'creating'
      ? 'Creating conversation…'
      : snapshot.activity === 'replacing'
      ? 'Releasing conversation…'
      : 'Receiving response…'
    : !snapshot.canSubmit
    ? 'Start a new conversation to continue.'
    : snapshot.outcome === 'success'
    ? 'Response saved.'
    : 'Ready.';
  return (
    <main className="timeline-demo">
      <header>
        <div>
          <p className="eyebrow">React · Experimental</p>
          <h1>Chat timeline</h1>
        </div>
        <button
          type="button"
          disabled={snapshot.busy}
          onClick={() => {
            if (currentView()) void application.newConversation();
          }}
        >
          New conversation
        </button>
      </header>
      <p>
        Select a saved checkpoint to preview it. Send always continues the
        current conversation. Fork from here uses the message in the composer to
        continue from the selected checkpoint.
      </p>
      <div className="timeline-layout">
        <section className="current-panel" aria-label="Current conversation">
          <h2>Current conversation</h2>
          <MessageList
            key={`current:${snapshot.viewGeneration}`}
            rows={snapshot.rows}
            renderMessage={renderMessage}
            label="Current messages"
          />
          {snapshot.error && <p role="alert">{snapshot.error}</p>}
          <ChatInput
            key={`composer:${snapshot.viewGeneration}`}
            label="Message"
            value={snapshot.draft}
            onValueChange={(text) => {
              if (currentView()) application.setDraft(text);
            }}
            placeholder="Write a message…"
            hint="Enter to send. Shift+Enter adds a new line."
            busy={snapshot.busy}
            disabled={snapshot.busy || !snapshot.canSubmit}
            onStop={
              snapshot.busy && snapshot.activity !== 'replacing'
                ? () => {
                    if (currentView()) void application.stop();
                  }
                : undefined
            }
            onSubmit={(text) => {
              const current = application.getSnapshot();
              if (!currentView() || !current.canSubmit || current.busy)
                return false;
              void application.submit(text);
              return true;
            }}
          />
          <p role="status">{status}</p>
        </section>
        <aside className="history-panel" aria-label="Timeline">
          <nav className="checkpoint-picker" aria-label="Saved checkpoints">
            <div className="panel-heading">
              <h2>Saved checkpoints</h2>
              <button
                type="button"
                disabled={!snapshot.canRefresh || snapshot.readingHistory}
                onClick={() => {
                  if (currentView()) void application.refreshHistory();
                }}
              >
                Refresh checkpoints
              </button>
            </div>
            {!snapshot.threadId && (
              <p>Send a message to begin saving checkpoints.</p>
            )}
            {snapshot.threadId &&
              snapshot.historyPage === undefined &&
              !snapshot.readingHistory && (
                <p>Refresh to see saved checkpoints.</p>
              )}
            {snapshot.readingHistory && (
              <p role="status">Loading checkpoints…</p>
            )}
            {snapshot.historyError && (
              <p role="alert">{snapshot.historyError}</p>
            )}
            {snapshot.historyPage?.length === 0 && (
              <p>No checkpoints available.</p>
            )}
            {snapshot.historyPage?.map((row, index) => (
              <button
                key={index}
                type="button"
                aria-pressed={
                  !!row.source && row.source === snapshot.selectedSource
                }
                disabled={
                  !row.source ||
                  snapshot.busy ||
                  snapshot.readingHistory ||
                  !snapshot.canSubmit
                }
                onClick={() => {
                  if (
                    currentView() &&
                    application.getSnapshot().historyPage?.[index] === row
                  )
                    void application.selectCheckpoint(index);
                }}
              >
                Checkpoint {index + 1}
                {!row.source ? ' (unavailable)' : ''}
                {row.createdAt && (
                  <span className="checkpoint-time">{row.createdAt}</span>
                )}
              </button>
            ))}
          </nav>
          <section className="preview-panel" aria-label="Historical preview">
            <h2>Historical preview</h2>
            <p>
              Read-only. Selecting a checkpoint does not change where Send
              continues.
            </p>
            {!snapshot.selectedSource && (
              <p>Select a checkpoint to preview its messages.</p>
            )}
            {snapshot.readingPreview && <p role="status">Loading preview…</p>}
            {snapshot.previewError && (
              <p role="alert">{snapshot.previewError}</p>
            )}
            <MessageList
              key={`${snapshot.viewGeneration}:${
                snapshot.historyPage?.findIndex(
                  (row) => row.source === snapshot.selectedSource
                ) ?? -1
              }`}
              rows={snapshot.previewRows}
              renderMessage={renderMessage}
              label="Preview messages"
            />
            <div className="preview-actions">
              <button
                type="button"
                disabled={!snapshot.canFork || !snapshot.draft.trim()}
                onClick={() => {
                  const current = application.getSnapshot();
                  if (
                    currentView() &&
                    current.selectedSource === snapshot.selectedSource &&
                    current.canFork &&
                    current.draft.trim()
                  )
                    void application.forkSelected(current.draft);
                }}
              >
                Fork from here
              </button>
              {snapshot.readingPreview ? (
                <button
                  type="button"
                  onClick={() => {
                    if (
                      currentView() &&
                      application.getSnapshot().selectedSource ===
                        snapshot.selectedSource
                    )
                      application.cancelPreview();
                  }}
                >
                  Cancel preview
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!snapshot.selectedSource}
                  onClick={() => {
                    if (
                      currentView() &&
                      application.getSnapshot().selectedSource ===
                        snapshot.selectedSource
                    )
                      application.clearSelection();
                  }}
                >
                  Clear selection
                </button>
              )}
            </div>
            <p>
              Fork from here sends the composer message from this checkpoint. A
              successful fork becomes the current conversation.
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}
