import { useEffect, useState } from 'react';
import { useAgent } from '@threadplane/react';
import {
  ApprovalCard,
  ChatInput,
  TextTranscript,
} from '@threadplane/react/chat';
import {
  createConnectedApplication,
  type mastraConnection,
} from './connection';

export function MastraDemo({
  connection,
  onReady,
}: {
  readonly connection: ReturnType<typeof mastraConnection>;
  readonly onReady: () => void;
}) {
  const [application] = useState(() => createConnectedApplication(connection));
  const [draft, setDraft] = useState('');
  const snapshot = useAgent(application);
  const generation = snapshot.viewGeneration;
  const approval = snapshot.approval;
  useEffect(() => {
    onReady();
  }, [onReady]);
  useEffect(
    () => () => {
      void Promise.resolve(application.dispose()).catch(() => undefined);
    },
    [application]
  );
  useEffect(() => {
    setDraft('');
  }, [generation]);
  const status = snapshot.busy
    ? snapshot.activity === 'replacing'
      ? 'Starting new conversation…'
      : 'Working on the reservation…'
    : snapshot.canRespond
    ? 'Awaiting your decision.'
    : snapshot.requiresNew || snapshot.reservation === 'unconfirmed'
    ? 'Reservation unconfirmed. Start a new conversation.'
    : snapshot.reservation === 'approved'
    ? 'Fictional reservation approved.'
    : snapshot.reservation === 'declined'
    ? 'Reservation declined. Nothing was booked.'
    : snapshot.outcome === 'success'
    ? 'Request complete.'
    : 'Ready.';
  return (
    <main className="mastra-demo">
      <header>
        <div>
          <p className="eyebrow">React · Experimental</p>
          <h1>Mastra reservations</h1>
        </div>
        <button
          type="button"
          disabled={snapshot.activity === 'replacing'}
          onClick={() => {
            void application.newConversation();
          }}
        >
          New conversation
        </button>
      </header>
      <p>
        Review a fictional campsite reservation, then approve or decline it. No
        real reservation is made.
      </p>
      <p className="preview-note">
        Private source-build preview · {connection.label}
      </p>
      <button
        type="button"
        className="preset"
        disabled={!snapshot.canSubmit}
        onClick={() =>
          setDraft('Please reserve the North Pines campsite for 2 nights.')
        }
      >
        Reserve the campsite
      </button>
      <TextTranscript messages={snapshot.rows} label="Conversation" />
      {approval && (
        <ApprovalCard
          key={approval.pause}
          title="Reservation approval"
          disabled={snapshot.busy || !snapshot.canRespond}
          actions={[
            {
              id: 'approve',
              label: 'Approve',
              onSelect: () => {
                void application.decide(approval, 'approve', generation);
              },
            },
            {
              id: 'decline',
              label: 'Decline',
              onSelect: () => {
                void application.decide(approval, 'decline', generation);
              },
            },
          ]}
        >
          <dl className="reservation-details">
            <dt>Campsite</dt>
            <dd>{approval.site}</dd>
            <dt>Nights</dt>
            <dd>{approval.nights}</dd>
            <dt>Total (USD)</dt>
            <dd>${approval.total.toFixed(2)}</dd>
          </dl>
          <p>
            This decision applies only to the fictional reservation shown here.
          </p>
        </ApprovalCard>
      )}
      {snapshot.result !== null && (
        <section
          aria-label="Observed backend result"
          className="backend-result"
        >
          <h2>Observed backend result</h2>
          <p>The correlated backend tool returned this literal JSON string:</p>
          <pre>{snapshot.result}</pre>
        </section>
      )}
      {snapshot.error && <p role="alert">{snapshot.error}</p>}
      <ChatInput
        label="Message"
        placeholder="Ask for a fictional campsite reservation…"
        value={draft}
        onValueChange={setDraft}
        disabled={!snapshot.canSubmit}
        busy={snapshot.busy}
        onStop={
          snapshot.busy && snapshot.activity !== 'replacing'
            ? () => {
                void application.stop();
              }
            : undefined
        }
        onSubmit={(text) => {
          void application.submit(text, generation);
          const current = application.getSnapshot();
          return (
            current.viewGeneration === generation &&
            current.busy &&
            current.activity === 'running'
          );
        }}
      />
      <p role="status">{status}</p>
    </main>
  );
}
