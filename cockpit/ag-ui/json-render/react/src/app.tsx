import { useEffect, useState } from 'react';
import { useAgent } from '@threadplane/react';
import {
  ChatInput,
  TextTranscript,
  ToolObservation,
} from '@threadplane/react/chat';
import { RenderSpec } from '@threadplane/react/render';
import {
  createConnectedApplication,
  type dashboardConnection,
} from './connection';
import { dashboardRegistry } from './dashboard-views';

export function DashboardDemo({
  connection,
  onReady,
}: {
  readonly connection: ReturnType<typeof dashboardConnection>;
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
  const transcript = snapshot.native?.transcript ?? [];
  const status = snapshot.busy
    ? snapshot.activity === 'replacing'
      ? 'Starting new conversation…'
      : 'Updating the dashboard…'
    : !snapshot.canSubmit
    ? 'Start a new conversation to continue.'
    : snapshot.outcome === 'success'
    ? 'Response complete.'
    : 'Ready.';
  return (
    <main className="dashboard-demo">
      <header>
        <div>
          <p className="eyebrow">React · Experimental</p>
          <h1>AG-UI airline dashboard</h1>
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
        Ask for an airline dashboard, then filter the disruptions or change its
        layout. This example uses fixed demo data.
      </p>
      <section aria-label="Runtime connection">
        <h2>Runtime connection</h2>
        <p>{connection.label}</p>
      </section>
      <section aria-label="Conversation" className="dashboard-conversation">
        <ol>
          {transcript.map((message) => {
            const surface = snapshot.surfaces.find(
              (item) => item.ownerId === message.id
            );
            const calls =
              message.role === 'assistant' ? message.toolCalls ?? [] : [];
            const text =
              (message.role === 'user' ||
                message.role === 'assistant' ||
                message.role === 'tool') &&
              typeof message.content === 'string' ? (
                <TextTranscript
                  messages={[
                    {
                      id: message.id,
                      role: message.role,
                      content: message.content,
                    },
                  ]}
                  label="Message text"
                />
              ) : null;
            return (
              <li key={message.id} data-dashboard-message={message.id}>
                {surface &&
                typeof message.content === 'string' &&
                message.content.trim().startsWith('{') ? (
                  <details>
                    <summary>Layout source</summary>
                    {text}
                  </details>
                ) : message.role === 'tool' ? (
                  <details>
                    <summary>Server tool result</summary>
                    {text}
                  </details>
                ) : (
                  text
                )}
                {surface && (
                  <div data-dashboard-spec-owner={message.id}>
                    <RenderSpec
                      spec={surface.spec}
                      registry={dashboardRegistry}
                      state={{ ...snapshot.projection?.state }}
                      loading={snapshot.busy}
                    />
                  </div>
                )}
                {calls.map((call) => {
                  const result = transcript.find(
                    (row) => row.role === 'tool' && row.toolCallId === call.id
                  );
                  return (
                    <details key={call.id} data-dashboard-tool={call.id}>
                      <summary>Tool details: {call.function.name}</summary>
                      <ToolObservation
                        name={call.function.name}
                        argumentsText={call.function.arguments}
                        resultText={
                          result?.role === 'tool' &&
                          typeof result.content === 'string'
                            ? result.content
                            : undefined
                        }
                      />
                    </details>
                  );
                })}
              </li>
            );
          })}
        </ol>
      </section>
      {snapshot.error && <p role="alert">{snapshot.error}</p>}
      <ChatInput
        label="Message"
        placeholder="Ask for an airline dashboard…"
        value={draft}
        onValueChange={setDraft}
        disabled={!snapshot.canSubmit}
        busy={snapshot.busy}
        onStop={snapshot.busy ? () => void application.stop() : undefined}
        onSubmit={(text) => {
          if (!application.getSnapshot().canSubmit) return false;
          void application.submit(text);
          return application.getSnapshot().busy;
        }}
      />
      <p role="status">{status}</p>
    </main>
  );
}
