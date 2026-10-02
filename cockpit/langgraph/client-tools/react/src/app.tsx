import { useEffect, useRef, useState } from 'react';
import { useAgent } from '@threadplane/react';
import { ApprovalCard, ChatInput, MessageList } from '@threadplane/react/chat';
import {
  createConnectedApplication,
  type clientToolsConnection,
} from './connection';

export function ClientToolsDemo({
  connection,
  onReady,
}: {
  readonly connection: ReturnType<typeof clientToolsConnection>;
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
      : 'Running simulated browser tools…'
    : snapshot.outcome === 'success' && snapshot.canSubmit
    ? 'Response complete.'
    : snapshot.outcome === 'aborted'
    ? 'Stopped. Start a new conversation to continue.'
    : !snapshot.canSubmit
    ? 'Start a new conversation to continue.'
    : 'Ready.';
  return (
    <main className="client-tools-demo">
      <header>
        <div>
          <p className="eyebrow">React · Experimental</p>
          <h1>LangGraph client tools</h1>
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
        Try simulated weather, a slow status check, a weather panel or snapshot,
        and a fictional booking decision. These browser tools use authored data;
        no real weather service or booking is contacted.
      </p>
      <MessageList rows={snapshot.rows} label="Conversation" />
      <section aria-label="Weather panels">
        <h2>Weather panels</h2>
        {snapshot.weather.length ? snapshot.weather.map((row) => (
          <dl key={row.id}>
            <div><dt>Location</dt><dd>{row.location}</dd></div>
            <div><dt>Temperature</dt><dd>{row.temperatureF} °F</dd></div>
            <div><dt>Conditions</dt><dd>{row.conditions}</dd></div>
            <div><dt>Humidity</dt><dd>{row.humidity}%</dd></div>
            <div><dt>Wind</dt><dd>{row.windMph} mph</dd></div>
          </dl>
        )) : <p>No weather panels yet.</p>}
      </section>
      <section aria-label="Booking decisions">
        <h2>Booking decisions</h2>
        {snapshot.bookings.length ? snapshot.bookings.map((row) => row.status === 'pending' ? (
          <ApprovalCard key={row.id} title="Simulated booking" disabled={resetting || !snapshot.busy}
            actions={[
              { id: 'confirm', label: 'Confirm booking', onSelect: () => { application.decide(row, true); } },
              { id: 'cancel', label: 'Cancel booking', onSelect: () => { application.decide(row, false); } },
            ]}>
            <p>{row.summary}</p>
          </ApprovalCard>
        ) : <div key={row.id}><p>{row.summary}</p><p>{({ confirmed: 'Confirmed', cancelled: 'Cancelled', aborted: 'Aborted' })[row.status]}</p></div>) : <p>No booking decisions yet.</p>}
      </section>
      {snapshot.error && <p role="alert">{snapshot.error}</p>}
      <ChatInput
        key={generation}
        label="Message"
        placeholder="Ask for weather or a fictional booking…"
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
