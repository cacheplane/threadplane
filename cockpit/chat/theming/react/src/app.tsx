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
  type themingConnection,
} from './connection';
import { themes, chatTokens, type Theme } from './themes';

/** Stable renderer: palettes keep the application's Markdown lifetimes. */
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
      <div className="theming-demo__message-body">
        {row.role === 'assistant' && row.reasoning && (
          <Reasoning snapshot={row.reasoning} />
        )}
        <Markdown snapshot={row.markdown} />
      </div>
      {row.role === 'assistant' && row.message.citations && (
        <Citations citations={row.message.citations} />
      )}
    </article>
  );
}
export function ThemingDemo({
  connection,
  onReady,
  applicationFactory = createConnectedApplication,
}: {
  readonly connection: ReturnType<typeof themingConnection>;
  readonly onReady: () => void;
  readonly applicationFactory?: typeof createConnectedApplication;
}) {
  const [application] = useState(() => applicationFactory(connection));
  const [theme, setTheme] = useState<Theme>('dark');
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
  const status =
    snapshot.activity === 'cleanup-failed'
      ? 'Reload the preview to continue.'
      : snapshot.busy
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
    <main
      className={`tp-chat theming-demo theming-demo--${theme}`}
      data-theme={theme}
    >
      <header className="theming-demo__header">
        <div>
          <p className="theming-demo__eyebrow">React · Experimental</p>
          <h1>Chat theming</h1>
        </div>
        <button
          type="button"
          disabled={snapshot.busy || snapshot.activity === 'cleanup-failed'}
          onClick={() => void application.newConversation()}
        >
          New conversation
        </button>
      </header>
      <p>
        Ask an aviation question and watch the answer arrive. Switch palettes at
        any time; your conversation and draft stay in place. Continue after the
        response is saved.
      </p>
      <div
        className="theming-demo__palettes"
        role="group"
        aria-label="Chat palette"
      >
        {themes.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={theme === id}
            onClick={() => setTheme(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <MessageList
        rows={snapshot.rows}
        renderMessage={renderMessage}
        label="Conversation"
      />
      {snapshot.error && (
        <p role="alert" className="tp-chat__error">
          {snapshot.error}
        </p>
      )}
      <ChatInput
        key={snapshot.viewGeneration}
        label="Message"
        placeholder="Ask an aviation question…"
        busy={snapshot.busy}
        disabled={
          snapshot.activity === 'cleanup-failed' ||
          (!snapshot.canSubmit && !snapshot.busy)
        }
        onStop={
          snapshot.busy && snapshot.activity !== 'cleanup-failed'
            ? () => void application.stop()
            : undefined
        }
        onSubmit={(text) => {
          const current = application.getSnapshot();
          // A retained callback belongs to its rendered conversation generation.
          if (
            current.viewGeneration !== snapshot.viewGeneration ||
            !current.canSubmit ||
            current.busy ||
            !text.trim()
          )
            return false;
          void application.submit(text, snapshot.viewGeneration);
          return true;
        }}
      />
      <p role="status" className="theming-demo__status">
        {status}
      </p>
      <details className="theming-demo__tokens" aria-label="Chat CSS variables">
        <summary>Eight chat CSS tokens</summary>
        <p>
          Each palette sets these properties on this chat. Try a different
          palette while keeping your draft.
        </p>
        <ul>
          {chatTokens.map((token) => (
            <li key={token}>
              <code>{token}</code>
            </li>
          ))}
        </ul>
      </details>
    </main>
  );
}
