import { useEffect, useState } from 'react';
import { useAgent } from '@threadplane/react';
import { ChatInput, MessageList } from '@threadplane/react/chat';
import {
  createConnectedApplication,
  type subgraphsConnection,
} from './connection';
export function SubgraphsDemo({
  connection,
  onReady,
}: {
  readonly connection: ReturnType<typeof subgraphsConnection>;
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
    <main className="subgraphs-demo">
      <header>
        <div>
          <p className="eyebrow">React · Experimental</p>
          <h1>LangGraph subgraphs</h1>
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
        A factual question enters a research child graph. A greeting answers
        directly. The child receives a topic, not the parent conversation.
      </p>
      <MessageList rows={snapshot.rows} label="Conversation" />
      <section aria-label="Research boundary">
        <h2>Research boundary</h2>
        <p>
          {snapshot.route === 'nested'
            ? 'Nested — research boundary confirmed.'
            : snapshot.route === 'direct'
            ? 'Direct — no child observed for this turn.'
            : snapshot.route === 'unconfirmed'
            ? 'Current route unconfirmed.'
            : 'Awaiting the current route.'}
        </p>
        {snapshot.route === 'nested' && (
          <dl>
            <div>
              <dt>Topic sent to child</dt>
              <dd>{snapshot.topic}</dd>
            </div>
            <div>
              <dt>Brief returned by child</dt>
              <dd>{snapshot.brief}</dd>
            </div>
          </dl>
        )}
        <p>
          The child shares only the topic and brief with the parent. Its
          internal stream remains separate from this conversation.
        </p>
      </section>
      <section aria-label="Child observations">
        <h2>Child observations</h2>
        {snapshot.children.length ? (
          snapshot.children.map((child) => (
            <div key={JSON.stringify(child.namespace)}>
              <p>Observed child stream</p>
              <ol>
                {child.namespace.map((segment, index) => (
                  <li key={index}>
                    <code>{segment}</code>
                  </li>
                ))}
              </ol>
            </div>
          ))
        ) : (
          <p>No child stream observed for this turn.</p>
        )}
        <p>
          Namespaces identify observed streams. They do not expose child
          execution status or controls.
        </p>
      </section>
      {snapshot.error && <p role="alert">{snapshot.error}</p>}
      <ChatInput
        key={snapshot.viewGeneration}
        label="Message"
        placeholder="Ask a factual question or say hello…"
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
