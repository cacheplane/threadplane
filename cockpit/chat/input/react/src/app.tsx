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
import { createConnectedApplication, type inputConnection } from './connection';

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
export function InputDemo({
  connection,
  onReady,
}: {
  readonly connection: ReturnType<typeof inputConnection>;
  readonly onReady: () => void;
}) {
  const [application] = useState(() => createConnectedApplication(connection));
  const [draft, setDraft] = useState('');
  const [placeholder, setPlaceholder] = useState('Ask an aviation question…');
  const [submitOnEnter, setSubmitOnEnter] = useState(true);
  const [disabled, setDisabled] = useState(false);
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
    <main className="input-demo">
      <header>
        <div>
          <p className="eyebrow">React · Experimental</p>
          <h1>Chat input</h1>
        </div>
        <button
          type="button"
          disabled={snapshot.busy}
          onClick={() => {
            if (application.getSnapshot().busy) return;
            setDraft('');
            void application.newConversation();
          }}
        >
          New conversation
        </button>
      </header>
      <p>
        Try the keyboard shortcuts and customize your composer. You can draft
        your next message while a response arrives.
      </p>
      <fieldset className="input-settings">
        <legend>Composer settings</legend>
        <label className="input-settings__placeholder">
          Custom placeholder
          <input
            type="text"
            value={placeholder}
            onChange={(event) => setPlaceholder(event.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={submitOnEnter}
            onChange={(event) => setSubmitOnEnter(event.target.checked)}
          />
          Enter sends a message
        </label>
        <label>
          <input
            type="checkbox"
            checked={disabled}
            onChange={(event) => setDisabled(event.target.checked)}
          />
          Disable message input
        </label>
      </fieldset>
      <MessageList
        rows={snapshot.rows}
        renderMessage={renderMessage}
        label="Conversation"
      />
      {snapshot.error && <p role="alert">{snapshot.error}</p>}
      <ChatInput
        key={snapshot.viewGeneration}
        label="Message"
        value={draft}
        onValueChange={setDraft}
        placeholder={placeholder}
        submitOnEnter={submitOnEnter}
        hint={
          submitOnEnter
            ? 'Enter to send. Shift+Enter adds a new line.'
            : 'Ctrl/Command+Enter to send. Enter adds a new line.'
        }
        busy={snapshot.busy}
        disabled={disabled || (!snapshot.canSubmit && !snapshot.busy)}
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
