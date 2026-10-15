import { useEffect, useLayoutEffect, useState } from 'react';
import { projectTextTranscript } from '@threadplane/ag-ui';
import { useAgent } from '@threadplane/react';
import {
  ApprovalCard,
  ChatInput,
  TextTranscript,
} from '@threadplane/react/chat';
import {
  createConnectedApplication,
  type strandsConnection,
} from './connection';
import type { Meeting } from './approval-policy';

export const MEETING_PRESET =
  'This is a fictional demo meeting. Check availability for Tuesday, then book Q3 roadmap review for Tuesday 10:00 after my approval.';
function MeetingDetails({
  meeting,
}: {
  readonly meeting: Readonly<Partial<Meeting>>;
}) {
  return (
    <dl className="meeting-details">
      <dt>Topic</dt>
      <dd>{meeting.topic ?? 'Not observed'}</dd>
      <dt>Slot</dt>
      <dd>{meeting.slot ?? 'Not observed'}</dd>
    </dl>
  );
}

export function StrandsDemo({
  connection,
  onReady,
}: {
  readonly connection: ReturnType<typeof strandsConnection>;
  readonly onReady: () => void;
}) {
  // Applications are lazy: construction allocates neither a thread nor a Session.
  // The stable owner survives StrictMode effect rehearsal; disposed applications do not.
  type Application = ReturnType<typeof createConnectedApplication>;
  const [owner] = useState<{
    current?: Application;
    connection: typeof connection;
  }>(() => ({ connection }));
  const [application, setApplication] = useState<Application | null>(null);
  useLayoutEffect(() => {
    if (!owner.current || owner.current.getSnapshot().status === 'disposed')
      owner.current = createConnectedApplication(owner.connection);
    const acquired = owner.current;
    setApplication(acquired);
    return () => {
      void acquired.dispose().catch(() => undefined);
    };
  }, [owner]);
  return application ? (
    <StrandsPresentation
      application={application}
      label={owner.connection.label}
      onReady={onReady}
    />
  ) : (
    <p role="status">Starting meeting preview…</p>
  );
}

function StrandsPresentation({
  application,
  label,
  onReady,
}: {
  readonly application: ReturnType<typeof createConnectedApplication>;
  readonly label: ReturnType<typeof strandsConnection>['label'];
  readonly onReady: () => void;
}) {
  const [draft, setDraft] = useState('');
  const snapshot = useAgent(application);
  const generation = snapshot.generation;
  const approval = snapshot.approval;
  useEffect(() => {
    if (application.getSnapshot().status !== 'disposed') onReady();
  }, [application, onReady]);
  useEffect(() => {
    setDraft('');
  }, [generation]);
  const status = {
    ready: 'Ready.',
    running: 'Checking the meeting…',
    pending: 'Awaiting your decision.',
    approved: 'Fictional meeting booked.',
    declined: 'Meeting declined.',
    unconfirmed: 'Meeting unconfirmed. Start a new conversation.',
    'cleanup-failed': 'Conversation could not close. Reload the preview.',
    replacing: 'Starting new conversation…',
    disposed: 'Preview closed.',
  }[snapshot.status];
  return (
    <main className="strands-demo">
      <header>
        <div>
          <p className="eyebrow">React · Experimental</p>
          <h1>AWS Strands meetings</h1>
        </div>
        <button
          type="button"
          disabled={
            snapshot.status === 'replacing' ||
            snapshot.status === 'disposed' ||
            snapshot.status === 'cleanup-failed'
          }
          onClick={() => {
            void application.newConversation();
          }}
        >
          New conversation
        </button>
      </header>
      <p>
        Review a fictional meeting, then approve or decline it. No real meeting
        is booked.
      </p>
      <p className="preview-note">Source-build preview · {label}</p>
      <button
        type="button"
        className="preset"
        disabled={!snapshot.canSend}
        onClick={() => setDraft(MEETING_PRESET)}
      >
        Q3 roadmap review
      </button>
      <TextTranscript
        messages={projectTextTranscript(snapshot.rows)}
        label="Conversation"
      />
      <section
        aria-label="Last observed schedule"
        className="observed-schedule"
      >
        <h2>Last observed schedule</h2>
        <p>
          The last snapshot can still show pending after the meeting tool
          finishes. See the separate backend result for the confirmed decision.
        </p>
        {snapshot.schedule?.availability ? (
          <p>
            Availability · {snapshot.schedule.availability.day}:{' '}
            {snapshot.schedule.availability.slots.join(', ') ||
              'No slots observed'}
          </p>
        ) : (
          <p>No availability observed yet.</p>
        )}
        {snapshot.schedule?.booking ? (
          <>
            <MeetingDetails meeting={snapshot.schedule.booking} />
            <p>
              Observed booking status:{' '}
              {snapshot.schedule.booking.status ?? 'Not observed'}
            </p>
          </>
        ) : (
          <p>No booking observed yet.</p>
        )}
      </section>
      {approval && (
        <ApprovalCard
          title="Meeting approval"
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
          <MeetingDetails meeting={approval.meeting} />
          <p>This decision applies only to the fictional meeting shown here.</p>
        </ApprovalCard>
      )}
      {snapshot.result !== null && (
        <section
          aria-label="Observed backend result"
          className="backend-result"
        >
          <h2>Observed backend result</h2>
          <p>The meeting tool returned this exact text:</p>
          <pre>{snapshot.result}</pre>
        </section>
      )}
      {snapshot.error && <p role="alert">{snapshot.error}</p>}
      <section aria-label="Compose message">
        <ChatInput
          label="Message"
          placeholder="Ask about a fictional meeting…"
          value={draft}
          onValueChange={setDraft}
          disabled={!snapshot.canSend}
          busy={snapshot.busy}
          onStop={
            snapshot.busy &&
            snapshot.status !== 'replacing' &&
            snapshot.status !== 'cleanup-failed'
              ? () => {
                  void application.stop();
                }
              : undefined
          }
          onSubmit={(text) => {
            void application.submit(text, generation);
            const current = application.getSnapshot();
            return (
              current.generation === generation &&
              current.busy &&
              current.status === 'running'
            );
          }}
        />
      </section>
      <p role="status">{status}</p>
    </main>
  );
}
