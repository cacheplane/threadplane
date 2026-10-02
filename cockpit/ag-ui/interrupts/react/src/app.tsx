import { useEffect, useState } from 'react';
import { useAgent } from '@threadplane/react';
import {
  ApprovalCard,
  ChatInput,
  TextTranscript,
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
      : 'Processing refund…'
    : snapshot.canRespond
    ? 'Awaiting your decision.'
    : !snapshot.canSubmit
    ? 'Start a new conversation to continue.'
    : snapshot.outcome === 'success'
    ? 'Refund decision complete.'
    : 'Ready.';
  return (
    <main className="streaming-demo">
      <header>
        <div>
          <p className="eyebrow">React · Experimental</p>
          <h1>AG-UI approvals</h1>
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
        Draft a fictional refund, review its amount, and approve, edit or cancel
        it. No real payment is issued. The conversation continues after each
        completed decision.
      </p>
      <section aria-label="Runtime connection">
        <h2>Runtime connection</h2>
        <p>{connection.label}</p>
      </section>
      <TextTranscript messages={snapshot.rows} label="Conversation" />
      {snapshot.approval && (
        <RefundCard
          key={snapshot.approval.pause}
          approval={snapshot.approval}
          application={application}
          disabled={snapshot.busy || !snapshot.canRespond}
        />
      )}
      {snapshot.error && <p role="alert">{snapshot.error}</p>}
      <ChatInput
        label="Message"
        placeholder="Ask a fictional refund request…"
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

function RefundCard({
  approval,
  application,
  disabled,
}: {
  readonly approval: RefundApproval;
  readonly application: ReturnType<typeof createInterruptsApplication>;
  readonly disabled: boolean;
}) {
  const [edited, setEdited] = useState(String(approval.amount));
  const amount = edited.trim() ? Number(edited) : NaN;
  const validAmount = Number.isFinite(amount) && amount >= 0;
  return (
    <ApprovalCard
      title="Refund approval"
      disabled={disabled}
      actions={[
        {
          id: 'approve',
          label: 'Approve',
          onSelect: () => {
            void application.respond(approval, 'approve');
          },
        },
        {
          id: 'edit',
          label: 'Edit and approve',
          disabled: !validAmount,
          onSelect: () => {
            if (validAmount) void application.respond(approval, 'edit', amount);
          },
        },
        {
          id: 'cancel',
          label: 'Cancel refund',
          onSelect: () => {
            void application.respond(approval, 'cancel');
          },
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
