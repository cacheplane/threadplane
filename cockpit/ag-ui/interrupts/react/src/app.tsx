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
import type { RefundApproval } from './approval-policy';
import type { createInterruptsApplication } from './application';
import {
  createConnectedApplication,
  type interruptsConnection,
} from './connection';

export function InterruptsDemo({
  connection,
  onReady,
}: {
  readonly connection: ReturnType<typeof interruptsConnection>;
  readonly onReady: () => void;
}) {
  const [application] = useState(() => createConnectedApplication(connection));
  const [draft, setDraft] = useState('');
  const snapshot = useAgent(application);
  // Answered approvals stay in the transcript as one-line records.
  const [records, setRecords] = useState<readonly ApprovalRecordEntry[]>([]);
  // Answering removes the card and its focused button; focus returns to the
  // composer as soon as the composer is enabled again.
  const composer = useRef<ChatInputHandle>(null);
  const [focusOwed, setFocusOwed] = useState(false);
  const pending = snapshot.approval !== undefined;
  const composerDisabled = !snapshot.canSubmit;
  useEffect(() => {
    if (!focusOwed || pending || composerDisabled) return;
    setFocusOwed(false);
    composer.current?.focus();
  }, [focusOwed, pending, composerDisabled]);
  function answered(verdict: ApprovalRecordEntry['verdict'], afterId?: string) {
    setRecords((previous) => [
      ...previous,
      { afterId, verdict, label: 'Issue refund' },
    ]);
    setFocusOwed(true);
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
  useEffect(() => {
    setDraft('');
    setRecords([]);
    setFocusOwed(false);
  }, [snapshot.viewGeneration]);
  const status = snapshot.busy
    ? snapshot.activity === 'replacing'
      ? 'Starting new conversation…'
      : 'Processing refund…'
    : snapshot.canRespond
    ? 'Awaiting your decision.'
    : !snapshot.canSubmit
    ? 'Start a new conversation to continue.'
    : snapshot.outcome === 'success'
    ? 'Refund decision complete.'
    : 'Ready.';
  return (
    <ExampleLayout className="streaming-demo">
      <header>
        <div>
          <h1>AG-UI approvals</h1>
        </div>
        <button
          type="button"
          disabled={snapshot.busy}
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
        Draft a fictional refund, review its amount, and approve, edit or cancel
        it. No real payment is issued. The conversation continues after each
        completed decision.
      </p>
      <section aria-label="Runtime connection">
        <h2>Runtime connection</h2>
        <p>{connection.label}</p>
      </section>
      <TextTranscript
        messages={snapshot.rows}
        label="Conversation"
        approvalRecords={records}
      >
        {snapshot.approval && (
          <RefundCard
            key={snapshot.approval.pause}
            approval={snapshot.approval}
            application={application}
            disabled={snapshot.busy || !snapshot.canRespond}
            onAnswered={answered}
          />
        )}
      </TextTranscript>
      <ExampleFooter>
        {snapshot.error && <p role="alert">{snapshot.error}</p>}
        <ChatInput
          ref={composer}
          label="Message"
          placeholder="Ask a fictional refund request…"
          value={draft}
          onValueChange={setDraft}
          disabled={composerDisabled}
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
      </ExampleFooter>
    </ExampleLayout>
  );
}

function RefundCard({
  approval,
  application,
  disabled,
  onAnswered,
}: {
  readonly approval: RefundApproval;
  readonly application: ReturnType<typeof createInterruptsApplication>;
  readonly disabled: boolean;
  readonly onAnswered: (
    verdict: ApprovalRecordEntry['verdict'],
    afterId?: string
  ) => void;
}) {
  const [edited, setEdited] = useState(String(approval.amount));
  const amount = edited.trim() ? Number(edited) : NaN;
  const validAmount = Number.isFinite(amount) && amount >= 0;
  function respond(action: 'approve' | 'edit' | 'cancel', value?: number) {
    const before = application.getSnapshot();
    if (action === 'edit') void application.respond(approval, action, value);
    else void application.respond(approval, action);
    // Record only a decision the application admitted.
    if (before.busy || !application.getSnapshot().busy) return;
    onAnswered(
      action === 'cancel' ? 'declined' : 'approved',
      before.rows.at(-1)?.id
    );
  }
  return (
    <ApprovalCard
      title="Refund approval"
      disabled={disabled}
      actions={[
        {
          id: 'approve',
          label: 'Issue refund',
          onSelect: () => respond('approve'),
        },
        {
          id: 'edit',
          label: 'Edit and approve',
          disabled: !validAmount,
          onSelect: () => {
            if (validAmount) respond('edit', amount);
          },
        },
        {
          id: 'cancel',
          label: "Don't refund",
          onSelect: () => respond('cancel'),
        },
      ]}
    >
      <dl>
        <dt>Customer</dt>
        <dd>{approval.customerId}</dd>
        <dt>Amount</dt>
        <dd>${approval.amount.toFixed(2)}</dd>
        <dt>Reason</dt>
        <dd>{approval.reason}</dd>
      </dl>
      <label>
        Edited amount (USD)
        <input
          type="number"
          min="0"
          step="0.01"
          value={edited}
          disabled={disabled}
          onChange={(event) => setEdited(event.target.value)}
        />
      </label>
      {!validAmount && <p>Enter a finite amount of zero or more.</p>}
    </ApprovalCard>
  );
}
