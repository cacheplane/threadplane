import { useEffect } from 'react';
import { useAgent } from '@threadplane/react';
import {
  ChatInput,
  MessageList,
  Reasoning,
  Citations,
} from '@threadplane/react/chat';
import { Markdown } from '@threadplane/react/markdown';
import { ChatDebug } from '@threadplane/react/debug';
import type { MessageRow } from '@threadplane/content/messages';
import type { DebugApplication } from './application';

/** Stable native renderer; panel visibility never changes Markdown ownership. */
function renderMessage(row: MessageRow) {
  const label =
    row.role === 'user'
      ? 'You'
      : row.role === 'assistant'
      ? 'Assistant'
      : 'System';
  return (
    <article
      className={`tp-chat-message tp-chat-message--${row.role}`}
      aria-label={label}
    >
      <p className="tp-chat-message__role">{label}</p>
      <div className="debug-demo__message-body">
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

/** The entrypoint supplies one application for this mount's lifetime. */
export function DebugDemo({
  application,
  onReady,
}: {
  readonly application: DebugApplication;
  readonly onReady: () => void;
}) {
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
      : snapshot.activity === 'creating'
      ? 'Creating conversation…'
      : snapshot.activity === 'running'
      ? 'Receiving response…'
      : snapshot.activity === 'confirming'
      ? 'Confirming saved response…'
      : snapshot.activity === 'refreshing'
      ? 'Refreshing checkpoint metadata…'
      : snapshot.activity === 'inspecting'
      ? 'Reading selected checkpoint…'
      : snapshot.activity === 'replacing'
      ? 'Closing previous conversation…'
      : snapshot.confirmed
      ? 'Response confirmed.'
      : snapshot.canSubmit
      ? 'Ready.'
      : 'Start a new conversation to continue.';
  const analysis =
    snapshot.current.status === 'ready' &&
    snapshot.current.values &&
    typeof snapshot.current.values === 'object' &&
    !Array.isArray(snapshot.current.values)
      ? (snapshot.current.values as Readonly<Record<string, unknown>>)[
          'analysis'
        ]
      : undefined;
  return (
    <main className="tp-chat debug-demo">
      <header className="debug-demo__header">
        <div>
          <p>React · Experimental</p>
          <h1>Chat debug</h1>
        </div>
        <button
          type="button"
          onClick={() => void application.newConversation()}
        >
          New conversation
        </button>
      </header>
      <p>
        Ask an aviation question. Watch the answer, processing result and
        summary arrive, then inspect the observed saved state.
      </p>
      <MessageList
        rows={snapshot.rows}
        renderMessage={renderMessage}
        label="Conversation"
      />
      {analysis !== null &&
        typeof analysis === 'object' &&
        'characters' in analysis &&
        'words' in analysis && (
          <p aria-label="Observed analysis">
            Observed analysis: {String(analysis.characters)} characters ·{' '}
            {String(analysis.words)} words
          </p>
        )}
      {snapshot.error && (
        <p role="alert" className="tp-chat__error">
          {snapshot.error}
        </p>
      )}
      {snapshot.readError && (
        <p role="status" aria-label="Checkpoint read status">
          {snapshot.readError}
        </p>
      )}
      <ChatInput
        key={snapshot.contextKey}
        label="Message"
        placeholder="Ask an aviation question…"
        busy={snapshot.busy}
        disabled={
          snapshot.activity === 'cleanup-failed' ||
          (!snapshot.canSubmit && !snapshot.busy)
        }
        onStop={
          snapshot.busy &&
          snapshot.activity !== 'replacing' &&
          snapshot.activity !== 'cleanup-failed'
            ? () => void application.stop()
            : undefined
        }
        onSubmit={(text) => {
          const current = application.getSnapshot();
          if (
            current.contextKey !== snapshot.contextKey ||
            !current.canSubmit ||
            current.busy ||
            !text.trim()
          )
            return false;
          void application.submit(text, snapshot.contextKey);
          return true;
        }}
      />
      <p role="status">{status}</p>
      <ChatDebug
        contextKey={snapshot.contextKey}
        current={snapshot.current}
        checkpointPage={snapshot.checkpointPage}
        selection={snapshot.selection}
        inspection={snapshot.inspection}
        activity={{ busy: snapshot.busy, status }}
        storageKey="threadplane-chat-debug-preferences"
        onRefresh={(request) => {
          void application.refresh(request);
          return undefined;
        }}
        onInspect={(selection) => {
          void application.inspect(selection);
          return undefined;
        }}
      />
    </main>
  );
}
