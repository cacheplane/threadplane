// eslint-disable-next-line @nx/enforce-module-boundaries -- The isolated consumer copies this internal example layout.
import { ExampleFooter, ExampleLayout } from '../../../../shared/react-example';
import { useEffect, useRef, useState } from 'react';
import { useAgent } from '@threadplane/react';
import {
  ChatInput,
  MessageList,
  Reasoning,
  Citations,
  ThreadSidebar,
} from '@threadplane/react/chat';
import { Markdown } from '@threadplane/react/markdown';
import type { MessageRow } from '@threadplane/content/messages';
import type { ThreadDirectory } from '@threadplane/core';
import {
  createThreadsClient,
  createThreadsDirectory,
  type ThreadsConnection,
} from './connection';
import { createThreadsApplication } from './application';

/** Render existing native content stores without retaining them outside their session owner. */
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
/** Shown when a listed conversation cannot be opened on this page. */
export const UNAVAILABLE_NOTICE =
  'This conversation could not be confirmed and cannot be continued here.';
export const EARLIER_VISIT_NOTICE =
  'This conversation was saved on an earlier visit and cannot be continued here.';
type Props = {
  readonly connection: ThreadsConnection;
  readonly onReady: () => void;
};
/** Give every changed runtime target a fresh application lifetime and an opaque React key. */
export function ThreadsDemo(props: Props) {
  const fingerprint = JSON.stringify([
    props.connection.apiUrl,
    Object.entries(props.connection.headers).sort(([a], [b]) =>
      a.localeCompare(b)
    ),
  ]);
  const identity = useRef({ fingerprint, version: 0 });
  if (identity.current.fingerprint !== fingerprint)
    identity.current = { fingerprint, version: identity.current.version + 1 };
  return <ThreadsOwner key={identity.current.version} {...props} />;
}
function ThreadsOwner({ connection, onReady }: Props) {
  const [application] = useState(() =>
    createThreadsApplication(createThreadsClient(connection))
  );
  // Created and disposed by the same effect, so a StrictMode remount gets a
  // fresh directory instead of one its first cleanup already disposed.
  const [directory, setDirectory] = useState<ThreadDirectory | null>(null);
  useEffect(() => {
    const created = createThreadsDirectory(connection);
    setDirectory(created);
    return () => created.dispose();
  }, [connection]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const snapshot = useAgent(application);
  const [notice, setNotice] = useState<string | null>(null);
  // A new view (selection, New, removal) replaces any earlier notice.
  useEffect(() => setNotice(null), [snapshot.viewGeneration]);
  useEffect(() => {
    onReady();
  }, [onReady]);
  useEffect(
    () => () => {
      void application.dispose();
    },
    [application]
  );
  // The sidebar refreshes itself on mount and after each row command. A new
  // saved conversation, a saved response (the graph writes the title) and a
  // loaded conversation also refresh it.
  const confirmedThreads = snapshot.conversations
    .map((record) => record.threadId)
    .join(' ');
  useEffect(() => {
    if (!directory) return;
    if (!confirmedThreads && snapshot.confirmation === null) return;
    directory.refresh().catch(() => undefined);
  }, [directory, confirmedThreads, snapshot.confirmation]);
  const status = snapshot.busy
    ? snapshot.activity === 'creating'
      ? 'Creating conversation…'
      : snapshot.activity === 'loading'
      ? 'Loading saved conversation…'
      : snapshot.activity === 'confirming'
      ? 'Confirming saved conversation…'
      : snapshot.activity === 'replacing'
      ? 'Releasing conversation…'
      : 'Receiving response…'
    : !snapshot.canSubmit
    ? 'Choose another conversation or start a new one.'
    : snapshot.confirmation === 'loaded'
    ? 'Conversation loaded.'
    : snapshot.confirmation === 'saved'
    ? 'Response saved.'
    : 'Ready.';
  return (
    <ExampleLayout
      className="threads-demo"
      about={
        <div className="seed-prompts" aria-label="Example prompts">
          <button
            type="button"
            disabled={snapshot.busy || !snapshot.canSubmit}
            onClick={() => {
              const current = application.getSnapshot();
              if (current.canSubmit && !current.busy)
                application.setDraft(
                  snapshot.viewGeneration,
                  'Explain how saved conversations work in two sentences.'
                );
            }}
          >
            Try a question
          </button>
        </div>
      }
    >
      <header>
        <div>
          <h1>Chat threads</h1>
        </div>
        <button
          type="button"
          disabled={snapshot.busy}
          onClick={() => void application.newConversation()}
        >
          New conversation
        </button>
      </header>
      <p>
        The sidebar lists the conversations saved on the server: rename, pin,
        reorder, archive, delete or move them into a project from each row menu,
        and select a project to list only its conversations. Conversations
        created on this page can be continued; their drafts last while this page
        stays open and saved history is checked before continuing. Titles are
        optional.
      </p>
      <div className="threads-layout">
        <nav aria-label="Conversations" className="conversation-picker">
          {directory && (
            <ThreadSidebar
              directory={directory}
              activeThreadId={snapshot.threadId}
              onSelect={(threadId) => {
                // Only conversations confirmed on this page can be continued.
                const record = application
                  .getSnapshot()
                  .conversations.find((entry) => entry.threadId === threadId);
                if (!record) setNotice(EARLIER_VISIT_NOTICE);
                else if (record.availability === 'unavailable')
                  setNotice(UNAVAILABLE_NOTICE);
                else {
                  setNotice(null);
                  void application.select(record.key);
                }
              }}
              onNewChat={() => void application.newConversation()}
              onActiveRemoved={() => void application.newConversation()}
              // Selecting a project lists only its conversations; selecting it
              // again lists them all.
              selectedProjectId={projectId}
              onProjectSelect={(id) =>
                setProjectId((current) => (current === id ? null : id))
              }
              labels={{ empty: 'No saved conversations yet.' }}
            />
          )}
          <p className="conversation-notice" aria-live="polite">
            {notice}
          </p>
        </nav>
        <section
          className="conversation-panel"
          aria-label="Selected conversation"
        >
          <MessageList
            running={
              snapshot.activity === 'creating' ||
              snapshot.activity === 'running'
            }
            typingIndicator={{ announce: false }}
            rows={snapshot.rows}
            renderMessage={renderMessage}
            label="Conversation"
          />
          <ExampleFooter>
            {snapshot.error && <p role="alert">{snapshot.error}</p>}
            <ChatInput
              key={snapshot.viewGeneration}
              label="Message"
              value={snapshot.draft}
              onValueChange={(text) =>
                application.setDraft(snapshot.viewGeneration, text)
              }
              placeholder="Write a message…"
              hint="Enter to send. Shift+Enter adds a new line."
              busy={snapshot.busy}
              disabled={
                snapshot.activity === 'loading' ||
                snapshot.activity === 'replacing' ||
                (!snapshot.canSubmit && !snapshot.busy)
              }
              onStop={
                snapshot.busy && snapshot.activity !== 'replacing'
                  ? () => void application.stop()
                  : undefined
              }
              onSubmit={(text) => {
                const current = application.getSnapshot();
                if (
                  !current.canSubmit ||
                  current.busy ||
                  current.viewGeneration !== snapshot.viewGeneration
                )
                  return false;
                void application.submit(text);
                return true;
              }}
            />
            <p role="status">{status}</p>
          </ExampleFooter>
        </section>
      </div>
    </ExampleLayout>
  );
}
