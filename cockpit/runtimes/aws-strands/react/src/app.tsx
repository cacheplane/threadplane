// eslint-disable-next-line @nx/enforce-module-boundaries -- The isolated consumer copies this internal example layout.
import { ExampleFooter, ExampleLayout } from '../../../../shared/react-example';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { projectTextTranscript } from '@threadplane/ag-ui';
import { useAgent } from '@threadplane/react';
import {
  ApprovalCard,
  ChatInput,
  TextTranscript,
  type ApprovalRecordEntry,
  type ChatInputHandle,
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
  const rows = projectTextTranscript(snapshot.rows);
  // Answered approvals stay in the transcript as one-line records.
  const [records, setRecords] = useState<readonly ApprovalRecordEntry[]>([]);
  // Answering removes the card and its focused button; focus returns to the
  // composer as soon as the composer is enabled again.
  const composer = useRef<ChatInputHandle>(null);
  const [focusOwed, setFocusOwed] = useState(false);
  const pending = approval !== undefined;
  const composerDisabled = !snapshot.canSend;
  useEffect(() => {
    if (!focusOwed || pending || composerDisabled) return;
    setFocusOwed(false);
    composer.current?.focus();
  }, [focusOwed, pending, composerDisabled]);
  function decide(action: 'approve' | 'decline') {
    if (!approval) return;
    const before = application.getSnapshot();
    const afterId = projectTextTranscript(before.rows).at(-1)?.id;
    void application.decide(approval, action, generation);
    // Record only a decision the application admitted.
    if (before.busy || !application.getSnapshot().busy) return;
    setRecords((previous) => [
      ...previous,
      { afterId, verdict: action === 'approve' ? 'approved' : 'declined' },
    ]);
    setFocusOwed(true);
  }
  useEffect(() => {
    if (application.getSnapshot().status !== 'disposed') onReady();
  }, [application, onReady]);
  useEffect(() => {
    setDraft('');
    setRecords([]);
    setFocusOwed(false);
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
    <ExampleLayout className="strands-demo">
      <header>
        <div>
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
            setRecords([]);
            setFocusOwed(false);
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
        messages={rows}
        label="Conversation"
        approvalRecords={records}
      >
        {approval && (
          <ApprovalCard
            title="Meeting approval"
            disabled={snapshot.busy || !snapshot.canRespond}
            actions={[
              {
                id: 'approve',
                label: 'Approve',
                onSelect: () => decide('approve'),
              },
              {
                id: 'decline',
                label: 'Decline',
                onSelect: () => decide('decline'),
              },
            ]}
          >
            <MeetingDetails meeting={approval.meeting} />
            <p>
              This decision applies only to the fictional meeting shown here.
            </p>
          </ApprovalCard>
        )}
      </TextTranscript>
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
      <ExampleFooter>
        {snapshot.error && <p role="alert">{snapshot.error}</p>}
        <section aria-label="Compose message">
          <ChatInput
            ref={composer}
            label="Message"
            placeholder="Ask about a fictional meeting…"
            value={draft}
            onValueChange={setDraft}
            disabled={composerDisabled}
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
      </ExampleFooter>
    </ExampleLayout>
  );
}
