import { useEffect, useState } from 'react';
import { useAgent } from '@threadplane/react';
import { ChatInput, MessageList } from '@threadplane/react/chat';
import {
  createConnectedApplication,
  type durableConnection,
} from './connection';
export function DurableDemo({
  connection,
  onReady,
}: {
  readonly connection: ReturnType<typeof durableConnection>;
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
    ? snapshot.activity === 'checking'
      ? 'Checking saved outcome…'
      : snapshot.activity === 'creating'
      ? 'Creating conversation…'
      : snapshot.activity === 'replacing'
      ? 'Starting new conversation…'
      : 'Receiving response…'
    : snapshot.outcome === 'aborted'
    ? 'Stopped. Start a new conversation to continue.'
    : snapshot.canCheck
    ? 'The outcome is uncertain. Check its saved status.'
    : !snapshot.canSubmit
    ? 'Start a new conversation to continue.'
    : snapshot.outcome === 'success'
    ? 'Response complete.'
    : 'Ready.';
  const latest = snapshot.checkpoints.find(
    (step) => step.id === snapshot.latestCheckpoint
  );
  return (
    <main className="durable-demo">
      <header>
        <div>
          <p className="eyebrow">React · Experimental</p>
          <h1>LangGraph durable execution</h1>
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
        Follow a request through Analyze, Plan and Generate. Each completed node
        saves a checkpoint on the server.
      </p>
      <section
        className="saved-checkpoints"
        aria-label="Saved pipeline checkpoints"
      >
        <h2>Saved pipeline checkpoints</h2>
        <ol>
          {snapshot.checkpoints.map((step) => (
            <li key={step.id}>
              {step.label} — {step.status}
            </li>
          ))}
        </ol>
        <p>
          {latest
            ? `Latest checkpoint: ${latest.label}`
            : 'No checkpoint observed for this request yet.'}
        </p>
        <p>
          Checkpoints track completed nodes. A final reply replaces the
          intermediate drafts.
        </p>
      </section>
      <MessageList rows={snapshot.rows} label="Conversation" />
      {snapshot.error && <p role="alert">{snapshot.error}</p>}
      {snapshot.canCheck && !snapshot.busy && (
        <button type="button" onClick={() => void application.checkStatus()}>
          Check status
        </button>
      )}
      <ChatInput
        key={snapshot.viewGeneration}
        label="Message"
        placeholder="Plan a fictional project…"
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
