// eslint-disable-next-line @nx/enforce-module-boundaries -- The isolated consumer copies this internal example layout.
import { ExampleFooter, ExampleLayout } from '../../../../shared/react-example';
import { useEffect, useRef, useState } from 'react';
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
  // Answered approvals stay in the transcript as one-line records.
  const [records, setRecords] = useState<readonly ApprovalRecordEntry[]>([]);
  // Answering removes the card and its focused button; focus returns to the
  // composer as soon as the composer is enabled again.
  const composer = useRef<ChatInputHandle>(null);
  const [focusOwed, setFocusOwed] = useState(false);
  const pending = approval !== undefined;
  const composerDisabled = !snapshot.canSubmit;
  useEffect(() => {
    if (!focusOwed || pending || composerDisabled) return;
    setFocusOwed(false);
    composer.current?.focus();
  }, [focusOwed, pending, composerDisabled]);
  function decide(action: 'approve' | 'decline') {
    if (!approval) return;
    const before = application.getSnapshot();
    void application.decide(approval, action, generation);
    // Record only a decision the application admitted.
    if (before.busy || !application.getSnapshot().busy) return;
    setRecords((previous) => [
      ...previous,
      {
        afterId: before.rows.at(-1)?.id,
        verdict: action === 'approve' ? 'approved' : 'declined',
      },
    ]);
    setFocusOwed(true);
  }
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
    setRecords([]);
    setFocusOwed(false);
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
    <ExampleLayout className="mastra-demo">
      <header>
        <div>
          <h1>Mastra reservations</h1>
        </div>
        <button
          type="button"
          disabled={snapshot.activity === 'replacing'}
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
      <TextTranscript
        messages={snapshot.rows}
        label="Conversation"
        approvalRecords={records}
      >
        {approval && (
          <ApprovalCard
            key={approval.pause}
            title="Reservation approval"
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
            <dl className="reservation-details">
              <dt>Campsite</dt>
              <dd>{approval.site}</dd>
              <dt>Nights</dt>
              <dd>{approval.nights}</dd>
              <dt>Total (USD)</dt>
              <dd>${approval.total.toFixed(2)}</dd>
            </dl>
            <p>
              This decision applies only to the fictional reservation shown
              here.
            </p>
          </ApprovalCard>
        )}
      </TextTranscript>
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
      <ExampleFooter>
        {snapshot.error && <p role="alert">{snapshot.error}</p>}
        <ChatInput
          ref={composer}
          label="Message"
          placeholder="Ask for a fictional campsite reservation…"
          value={draft}
          onValueChange={setDraft}
          disabled={composerDisabled}
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
      </ExampleFooter>
    </ExampleLayout>
  );
}
