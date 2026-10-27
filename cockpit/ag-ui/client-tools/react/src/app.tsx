import { useEffect, useState } from 'react';
import { useAgent } from '@threadplane/react';
import {
  ChatInput,
  TextTranscript,
  ToolObservation,
} from '@threadplane/react/chat';
import {
  createConnectedApplication,
  type ClientToolsConnection,
} from './connection';
import { WeatherCard } from './weather-card';
import { ConfirmBooking } from './confirm-booking';
const prompts = Object.freeze([
  {
    label: 'Weather result',
    text: 'Use get_weather for simulated weather in San Francisco.',
  },
  {
    label: 'Slow status',
    text: 'Run slow_status_check with the label demo check.',
  },
  {
    label: 'Weather card',
    text: 'Show simulated weather with weather_card for San Francisco.',
  },
  {
    label: 'Terminal snapshot',
    text: 'Show simulated weather with weather_snapshot without a follow-up.',
  },
  {
    label: 'Fictional booking',
    text: 'Ask me to confirm a fictional dinner booking with confirm_booking.',
  },
]);
export function ClientToolsDemo({
  connection,
  onReady,
}: {
  readonly connection: ClientToolsConnection;
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
      ? 'Starting a new conversation…'
      : snapshot.bookings.some((row) => row.status === 'pending')
      ? 'Waiting for your fictional booking decision…'
      : 'Running client tools…'
    : !snapshot.canSubmit
    ? 'Start a new conversation to continue.'
    : snapshot.outcome === 'success'
    ? 'Command complete.'
    : 'Ready.';
  return (
    <main className="client-tools-demo">
      <header>
        <div>
          <p className="eyebrow">React · Experimental</p>
          <h1>AG-UI client tools</h1>
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
        Five browser tools demonstrate simulated weather, a cancellable status
        check and an explicit fictional booking decision.
      </p>
      <section aria-label="Runtime connection">
        <h2>Runtime connection</h2>
        <p>{connection.label}</p>
      </section>
      <div role="group" aria-label="Example prompts" className="prompt-presets">
        {prompts.map((prompt) => (
          <button
            key={prompt.label}
            type="button"
            disabled={snapshot.busy}
            onClick={() => setDraft(prompt.text)}
          >
            {prompt.label}
          </button>
        ))}
      </div>
      <section aria-label="Conversation" className="client-tools-conversation">
        <ol>
          {snapshot.views.map((message) => (
            <li key={message.id} data-native-message={message.id}>
              {message.text && (
                <TextTranscript
                  messages={[message.text]}
                  label="Message text"
                />
              )}
              {message.tools.map((tool) => (
                <div key={tool.id} data-native-call={tool.id}>
                  <ToolObservation
                    name={tool.name}
                    argumentsText={tool.argumentsText}
                    resultText={tool.resultText}
                  />
                  {tool.local && (
                    <section aria-label="Local tool evidence">
                      <p>Local execution: {tool.local.status}</p>
                      <p>Delivery: {tool.local.delivery}</p>
                    </section>
                  )}
                  {tool.weather && <WeatherCard reading={tool.weather} />}
                  {snapshot.bookings
                    .filter(
                      (booking) =>
                        booking.assistantMessageId === message.id &&
                        booking.callId === tool.id &&
                        booking.sourceRunId === tool.sourceRunId &&
                        tool.local?.name === 'confirm_booking'
                    )
                    .map((booking) => (
                      <ConfirmBooking
                        key={booking.token}
                        booking={booking}
                        respond={(token, confirmed) => {
                          application.respond(token, confirmed);
                        }}
                      />
                    ))}
                </div>
              ))}
            </li>
          ))}
        </ol>
      </section>
      {snapshot.error && <p role="alert">{snapshot.error}</p>}
      <ChatInput
        label="Message"
        placeholder="Try an example prompt…"
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
