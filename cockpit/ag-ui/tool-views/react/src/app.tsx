import { useEffect, useState } from 'react';
import { useAgent } from '@threadplane/react';
import {
  ChatInput,
  TextTranscript,
  ToolObservation,
} from '@threadplane/react/chat';
import {
  createConnectedApplication,
  type toolViewsConnection,
} from './connection';
import { WeatherCard } from './weather-card';

export function ToolViewsDemo({
  connection,
  onReady,
}: {
  readonly connection: ReturnType<typeof toolViewsConnection>;
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
      : 'Getting a weather reading…'
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
          <h1>AG-UI weather cards</h1>
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
        Ask for a city’s weather. The agent runs a server tool and the page
        displays its demo reading alongside the conversation.
      </p>
      <section aria-label="Runtime connection">
        <h2>Runtime connection</h2>
        <p>{connection.label}</p>
      </section>
      <section aria-label="Conversation" className="weather-conversation">
        <ol>
          {snapshot.views.map((message) => (
            <li key={message.id} data-weather-message={message.id}>
              {message.text && (
                <TextTranscript
                  messages={[message.text]}
                  label="Message text"
                />
              )}
              {message.tools.map((tool) => (
                <div key={tool.id} data-weather-tool={tool.id}>
                  <WeatherCard reading={tool.weather} />
                  <details>
                    <summary>Tool details</summary>
                    <ToolObservation
                      name={tool.name}
                      argumentsText={tool.argumentsText}
                      resultText={tool.resultText}
                    />
                  </details>
                </div>
              ))}
            </li>
          ))}
        </ol>
      </section>
      {snapshot.error && <p role="alert">{snapshot.error}</p>}
      <ChatInput
        label="Message"
        placeholder="Ask for a city’s weather…"
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
