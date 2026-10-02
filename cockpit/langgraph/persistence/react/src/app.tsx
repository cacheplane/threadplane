import { useEffect, useState } from 'react';
import { useAgent } from '@threadplane/react';
import { ChatInput, MessageList } from '@threadplane/react/chat';
import {
  createConnectedApplication,
  type persistenceConnection,
} from './connection';

export function PersistenceDemo({
  connection,
  onReady,
}: {
  readonly connection: ReturnType<typeof persistenceConnection>;
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
    ? snapshot.activity === 'loading'
      ? 'Loading saved conversation…'
      : snapshot.activity === 'creating'
      ? 'Creating conversation…'
      : snapshot.activity === 'replacing'
      ? 'Starting new conversation…'
      : 'Receiving response…'
    : snapshot.outcome === 'aborted'
    ? 'Stopped. Start a new conversation to continue.'
    : !snapshot.canSubmit
    ? 'Start a new conversation to continue.'
    : snapshot.outcome === 'success'
    ? 'Response complete.'
    : 'Ready.';
  return (
    <main className="persistence-demo">
      <header>
        <div>
          <p className="eyebrow">React · Experimental</p>
          <h1>LangGraph persistence</h1>
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
        Create two conversations, then switch between them to load their saved
        history from the server.
      </p>
      <section aria-label="Saved conversations" className="saved-conversations">
        <h2>Saved conversations</h2>
        <p>
          This list belongs to the current page. Reloading clears the list;
          conversation history is saved on the server.
        </p>
        {snapshot.conversations.length ? (
          <div className="conversation-picker">
            {snapshot.conversations.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={snapshot.selectedId === entry.id}
                disabled={snapshot.busy || entry.availability === 'unavailable'}
                onClick={() => void application.select(entry)}
              >
                {entry.label}
                {entry.availability === 'unavailable' ? ' — unavailable' : ''}
              </button>
            ))}
          </div>
        ) : (
          <p>No saved conversations yet.</p>
        )}
      </section>
      <MessageList rows={snapshot.rows} label="Conversation" />
      {snapshot.error && <p role="alert">{snapshot.error}</p>}
      <ChatInput
        key={snapshot.viewGeneration}
        label="Message"
        placeholder="Tell me a fictional fact…"
        disabled={!snapshot.canSubmit}
        busy={snapshot.busy}
        onStop={snapshot.busy ? () => void application.stop() : undefined}
        onSubmit={(text) => {
          if (!application.getSnapshot().canSubmit) return false;
          void application.submit(text);
        }}
      />
      <p role="status">{status}</p>
    </main>
  );
}
