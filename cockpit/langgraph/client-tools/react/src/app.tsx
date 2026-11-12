// eslint-disable-next-line @nx/enforce-module-boundaries -- The isolated consumer copies this internal example layout.
import { ExampleLayout } from '../../../../shared/react-example';
import { useEffect, useRef, useState } from 'react';
import { useAgent } from '@threadplane/react';
import {
  ApprovalCard,
  Chat,
  type ApprovalRecordEntry,
} from '@threadplane/react/chat';
import type { BookingPanel } from './tools';
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
  const live = useRef(true);
  const snapshot = useAgent(application);
  // Answered bookings stay in the transcript as one-line records.
  const [records, setRecords] = useState<readonly ApprovalRecordEntry[]>([]);
  const pending = snapshot.bookings.filter((row) => row.status === 'pending');
  function decide(row: BookingPanel, confirmed: boolean) {
    const afterId = application.getSnapshot().rows.at(-1)?.id;
    // Record only a decision the application admitted.
    if (!application.decide(row, confirmed)) return;
    setRecords((previous) => [
      ...previous,
      { afterId, verdict: confirmed ? 'approved' : 'declined', label: 'Booking' },
    ]);
  }
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
    setRecords([]);
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
    <ExampleLayout className="client-tools-demo">
      <header>
        <div>
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
        a fictional booking decision, or a trip that plans its steps. These browser tools use authored data;
        no real weather service or booking is contacted.
      </p>
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
        placeholder="Ask for weather or a fictional booking…"
        disabled={resetting || !snapshot.canSubmit}
        approvalRecords={records}
        approval={
          pending.length
            ? pending.map((row, index) => (
                <ApprovalCard
                  key={row.id}
                  title="Confirm this fictional booking?"
                  disabled={resetting || !snapshot.busy}
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
