// eslint-disable-next-line @nx/enforce-module-boundaries -- The isolated consumer copies this internal example layout.
import { ExampleLayout } from '../../../../shared/react-example';
import { useCallback, useEffect, useState } from 'react';
import { useAgent } from '@threadplane/react';
import {
  ApprovalCard,
  Chat,
  type ApprovalRecordEntry,
  type ToolActivityInfo,
} from '@threadplane/react/chat';
import {
  createConnectedApplication,
  type ClientToolsConnection,
} from './connection';
import { WeatherCard } from './weather-card';
import type { BookingPanel } from './tools';
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
  {
    label: 'Plan a trip',
    text: 'Plan a trip to Portland: check the weather, then book it.',
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
  const snapshot = useAgent(application);
  // Answered bookings stay in the transcript as one-line records.
  const [records, setRecords] = useState<readonly ApprovalRecordEntry[]>([]);
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
    setRecords([]);
  }, [snapshot.viewGeneration]);
  function decide(row: BookingPanel, confirmed: boolean) {
    const afterId = application.agent.getSnapshot().messages.at(-1)?.id;
    // Record only a decision the application admitted.
    if (!application.respond(row.token, confirmed)) return;
    setRecords((previous) => [
      ...previous,
      { afterId, verdict: confirmed ? 'approved' : 'declined', label: 'Booking' },
    ]);
  }
  // Local execution evidence and a validated weather reading under each call.
  const { views } = snapshot;
  const renderToolResult = useCallback(
    (activity: ToolActivityInfo) => {
      const tool = views
        .flatMap((message) => message.tools)
        .find((entry) => entry.id === activity.id);
      if (!tool) return undefined;
      return (
        <div data-native-call={tool.id}>
          {tool.local && (
            <section aria-label="Local tool evidence">
              <p>Local execution: {tool.local.status}</p>
              <p>Delivery: {tool.local.delivery}</p>
            </section>
          )}
          {tool.weather && <WeatherCard reading={tool.weather} />}
        </div>
      );
    },
    [views]
  );
  const pending = snapshot.bookings.filter((row) => row.status === 'pending');
  const status = snapshot.busy
    ? snapshot.activity === 'replacing'
      ? 'Starting a new conversation…'
      : pending.length
      ? 'Waiting for your fictional booking decision…'
      : 'Running client tools…'
    : !snapshot.canSubmit
    ? 'Start a new conversation to continue.'
    : snapshot.outcome === 'success'
    ? 'Command complete.'
    : 'Ready.';
  return (
    <ExampleLayout className="client-tools-demo">
      <header>
        <div>
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
        Six example prompts demonstrate simulated weather, a cancellable status
        check, a fictional booking decision and a trip that plans its steps.
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
            disabled={!snapshot.canSubmit}
            onClick={() => void application.submit(prompt.text)}
          >
            {prompt.label}
          </button>
        ))}
      </div>
      {/*
        Chat owns the transcript, the progress view and the composer. The
        application is its session; a booking waits at the end of the
        transcript through the approval slot, which also hints the composer
        and returns focus to it once the composer is enabled again.
      */}
      <Chat
        session={application.agent}
        className="client-tools-chat"
        label="Message"
        placeholder="Try an example prompt…"
        disabled={!snapshot.canSubmit}
        renderToolResult={renderToolResult}
        approvalRecords={records}
        approval={
          pending.length
            ? pending.map((row, index) => (
                <ApprovalCard
                  key={row.token}
                  title="Confirm this fictional booking?"
                  disabled={!snapshot.busy}
                  autoFocus={index === 0}
                  actions={[
                    { id: 'confirm', label: 'Confirm booking', onSelect: () => decide(row, true) },
                    { id: 'cancel', label: "Don't book", onSelect: () => decide(row, false) },
                  ]}
                >
                  <p>{row.summary}</p>
                  <p>No real reservation is made.</p>
                </ApprovalCard>
              ))
            : undefined
        }
        inputFooter={
          <>
            {snapshot.error && <p role="alert">{snapshot.error}</p>}
            <p role="status">{status}</p>
          </>
        }
      />
    </ExampleLayout>
  );
}
