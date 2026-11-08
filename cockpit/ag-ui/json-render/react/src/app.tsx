// eslint-disable-next-line @nx/enforce-module-boundaries -- The isolated consumer copies this internal example layout.
import { ExampleFooter, ExampleLayout } from '../../../../shared/react-example';
import { useEffect, useState } from 'react';
import { useAgent } from '@threadplane/react';
import {
  ChatInput,
  MessageList,
  ToolActivityGroup,
} from '@threadplane/react/chat';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Pure metadata copied into the isolated consumer.
import { exampleToolLabel } from '../../../../shared/tool-presentation';
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
    <ExampleLayout
      className="dashboard-demo"
      about={
        <section aria-label="Runtime connection" className="runtime-details">
          <details>
            <summary>Runtime connection</summary>
            <p>{connection.label}</p>
          </details>
        </section>
      }
    >
      <header>
        <div>
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
      <MessageList rows={[]} label="Conversation" key={snapshot.viewGeneration}>
        <ol className="dashboard-native-rows" role="list">
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
                <p className="dashboard-native-text">{message.content}</p>
              ) : null;
            return (
              <li
                key={message.id}
                data-dashboard-message={message.id}
                className={`tp-chat-message tp-chat-message--${message.role}`}
              >
                <p className="tp-chat-message__role">
                  {message.role === 'user' ? 'You' : message.role}
                </p>
                {calls.length > 0 && (
                  <ToolActivityGroup
                    label="Airline data activity"
                    activities={calls.map((call) => {
                      const result = transcript.find(
                        (row) =>
                          row.role === 'tool' && row.toolCallId === call.id
                      );
                      // A correlated protocol ToolMessage is execution evidence; no result is an unknown outcome after delivery ends.
                      return {
                        id: call.id,
                        name: call.function.name,
                        label: exampleToolLabel(call.function.name),
                        phase: result
                          ? 'complete'
                          : snapshot.busy
                          ? 'running'
                          : snapshot.outcome === 'aborted'
                          ? 'stopped'
                          : 'unknown',
                        argumentsText: call.function.arguments,
                        resultText:
                          result?.role === 'tool' &&
                          typeof result.content === 'string'
                            ? result.content
                            : undefined,
                      };
                    })}
                  />
                )}
                {surface &&
                typeof message.content === 'string' &&
                message.content.trim().startsWith('{') ? (
                  <details>
                    <summary>Details</summary>
                    <p>Layout source</p>
                    {text}
                  </details>
                ) : message.role === 'tool' ? (
                  <details>
                    <summary>Details</summary>
                    <p>Server tool result</p>
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
              </li>
            );
          })}
        </ol>
      </MessageList>
      <ExampleFooter>
        {snapshot.error && <p role="alert">{snapshot.error}</p>}
        <ChatInput
          label="Message"
          hint="Enter to send. Shift+Enter adds a new line."
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
      </ExampleFooter>
    </ExampleLayout>
  );
}
