import { useEffect, useRef, useState } from 'react';
import { useAgent } from '@threadplane/react';
import { ChatInput, MessageList } from '@threadplane/react/chat';
import {
  createConnectedApplication,
  type memoryConnection,
} from './connection';

export function MemoryDemo({
  connection,
  onReady,
}: {
  readonly connection: ReturnType<typeof memoryConnection>;
  readonly onReady: () => void;
}) {
  const [application, setApplication] = useState(() =>
    createConnectedApplication(connection)
  );
  const [resetting, setResetting] = useState(false);
  const [generation, setGeneration] = useState(0);
  const live = useRef(true);
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
  useEffect(
    () => () => {
      live.current = false;
    },
    []
  );
  async function reset() {
    if (application.getSnapshot().busy || resetting) return;
    setResetting(true);
    await application.dispose();
    if (!live.current) return;
    setApplication(createConnectedApplication(connection));
    setGeneration((value) => value + 1);
    setResetting(false);
  }
  const status = snapshot.busy
    ? snapshot.creation === 'pending'
      ? 'Creating conversation…'
      : 'Receiving response and extracting facts…'
    : snapshot.outcome === 'success' && snapshot.canSubmit
    ? 'Response complete.'
    : snapshot.outcome === 'aborted'
    ? 'Stopped. Start a new conversation to continue.'
    : !snapshot.canSubmit
    ? 'Start a new conversation to continue.'
    : 'Ready.';
  return (
    <main className="memory-demo">
      <header>
        <div>
          <p className="eyebrow">React · Experimental</p>
          <h1>LangGraph memory</h1>
        </div>
        <button
          type="button"
          disabled={snapshot.busy || resetting}
          onClick={() => void reset()}
        >
          New conversation
        </button>
      </header>
      <p>
        Teach the assistant a fictional fact, then ask it to recall it in this
        conversation. Each reply is followed by a memory extraction pass. A new
        conversation starts empty.
      </p>
      <MessageList rows={snapshot.rows} label="Conversation" />
      <section aria-label="Learned facts" className="learned-facts">
        <h2>Learned facts</h2>
        <p>Confirmed facts for this thread.</p>
        {snapshot.facts.length ? (
          <dl>
            {snapshot.facts.map((fact) => (
              <div key={fact.key}>
                <dt>{fact.key}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p>No facts yet.</p>
        )}
      </section>
      {snapshot.error && <p role="alert">{snapshot.error}</p>}
      <ChatInput
        key={generation}
        label="Message"
        placeholder="Tell me a fictional fact…"
        disabled={resetting || !snapshot.canSubmit}
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
