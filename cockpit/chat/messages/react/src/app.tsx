import { useEffect, useState } from 'react';
import { useAgent } from '@threadplane/react';
import {
  ChatInput,
  MessageList,
  Reasoning,
  Citations,
} from '@threadplane/react/chat';
import { Markdown } from '@threadplane/react/markdown';
import type { MessageRow } from '@threadplane/content/messages';
import {
  createConnectedApplication,
  type messagesConnection,
} from './connection';

/** Stable row renderer; the application owns Markdown snapshot lifetimes. */
export function renderMessage(row: MessageRow) {
  if (row.role === 'tool') return null;
  const label =
    row.role === 'user'
      ? 'You'
      : row.role === 'assistant'
      ? 'Assistant'
      : 'System';
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
export function MessagesDemo({
  connection,
  onReady,
}: {
  readonly connection: ReturnType<typeof messagesConnection>;
  readonly onReady: () => void;
}) {
  const [application] = useState(() => createConnectedApplication(connection));
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
      : snapshot.activity === 'confirming'
      ? 'Confirming saved response…'
      : snapshot.activity === 'replacing'
      ? 'Starting a new conversation…'
      : snapshot.rows.at(-1)?.role === 'assistant'
      ? 'Receiving response…'
      : 'Waiting for the first response…'
    : snapshot.outcome === 'success'
    ? 'Response saved.'
    : snapshot.outcome === 'aborted'
    ? 'Stopped. Start a new conversation to continue.'
    : !snapshot.canSubmit
    ? 'Start a new conversation to continue.'
    : 'Ready.';
  return (
    <main className="messages-demo">
      <header>
        <div>
          <p className="eyebrow">React · Experimental</p>
          <h1>Chat messages</h1>
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
        Ask a question and watch the answer arrive. Continue after the response
        is saved.
      </p>
      <MessageList
        rows={snapshot.rows}
        renderMessage={renderMessage}
        label="Conversation"
      />
      {snapshot.error && <p role="alert">{snapshot.error}</p>}
      <ChatInput
        key={snapshot.viewGeneration}
        label="Message"
        placeholder="Ask an aviation question…"
        busy={snapshot.busy}
        disabled={!snapshot.canSubmit && !snapshot.busy}
        onStop={snapshot.busy ? () => void application.stop() : undefined}
        onSubmit={(text) => {
          if (!application.getSnapshot().canSubmit) return false;
          void application.submit(text);
          return true;
        }}
      />
      <p role="status">{status}</p>
    </main>
  );
}
