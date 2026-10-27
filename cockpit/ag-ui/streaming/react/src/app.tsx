import { useEffect, useState } from 'react';
import { useAgent } from '@threadplane/react';
import { ChatInput, TextTranscript } from '@threadplane/react/chat';
import {
  createConnectedApplication,
  type streamingConnection,
} from './connection';

export function StreamingDemo({
  connection,
  onReady,
}: {
  readonly connection: ReturnType<typeof streamingConnection>;
  readonly onReady: () => void;
}) {
  const [application] = useState(() => createConnectedApplication(connection));
  const [draft, setDraft] = useState('');
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
  useEffect(() => {
    setDraft('');
  }, [snapshot.viewGeneration]);
  const status = snapshot.busy
    ? snapshot.activity === 'replacing'
      ? 'Starting new conversation…'
      : 'Receiving response…'
    : !snapshot.canSubmit
    ? 'Start a new conversation to continue.'
    : snapshot.outcome === 'success'
    ? 'Response complete.'
    : 'Ready.';
  return (
    <main className="streaming-demo">
      <header>
        <div>
          <p className="eyebrow">React · Experimental</p>
          <h1>AG-UI streaming</h1>
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
        Watch an ordinary text reply arrive from the connected AG-UI agent. This
        experimental preview keeps the current conversation until you start a
        new one. Tools, pauses and uncertain outcomes require a new
        conversation.
      </p>
      <section aria-label="Runtime connection">
        <h2>Runtime connection</h2>
        <p>{connection.label}</p>
      </section>
      <TextTranscript messages={snapshot.rows} label="Conversation" />
      {snapshot.error && <p role="alert">{snapshot.error}</p>}
      <ChatInput
        label="Message"
        placeholder="Ask a fictional streaming question…"
        value={draft}
        onValueChange={setDraft}
        disabled={!snapshot.canSubmit}
        busy={snapshot.busy}
        onStop={snapshot.busy ? () => void application.stop() : undefined}
        onSubmit={(text) => {
          if (!application.getSnapshot().canSubmit) return false;
          void application.submit(text);
          if (!application.getSnapshot().busy) return false;
          return true;
        }}
      />
      <p role="status">{status}</p>
    </main>
  );
}
