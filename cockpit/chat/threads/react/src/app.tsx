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
import { createThreadsClient, type ThreadsConnection } from './connection';
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
    <main className="threads-demo">
      <header>
        <div>
          <p className="eyebrow">React · Experimental</p>
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
        Switch between conversations created on this page. The list and drafts
        last while this page stays open; saved history is checked before
        continuing. Titles are optional.
      </p>
      <div className="threads-layout">
        <nav aria-label="Conversations" className="conversation-picker">
          <h2>Conversations</h2>
          {snapshot.conversations.length === 0 && (
            <p>No saved conversations on this page yet.</p>
          )}
          {snapshot.conversations.map((record) => (
            <button
              type="button"
              key={record.key}
              aria-pressed={snapshot.selectedKey === record.key}
              disabled={snapshot.busy || record.availability === 'unavailable'}
              onClick={() => void application.select(record.key)}
            >
              {record.label}
              {record.availability === 'unavailable' ? ' (unavailable)' : ''}
            </button>
          ))}
        </nav>
        <section
          className="conversation-panel"
          aria-label="Selected conversation"
        >
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
          <MessageList
            rows={snapshot.rows}
            renderMessage={renderMessage}
            label="Conversation"
          />
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
        </section>
      </div>
    </main>
  );
}
