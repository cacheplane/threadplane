// eslint-disable-next-line @nx/enforce-module-boundaries -- The isolated consumer copies this internal example layout.
import { ExampleFooter, ExampleLayout } from '../../../../shared/react-example';
import { useEffect, useRef, useState } from 'react';
import { useAgent } from '@threadplane/react';
import {
  ApprovalCard,
  ChatInput,
  MessageList,
  type ApprovalRecordEntry,
  type ChatInputHandle,
} from '@threadplane/react/chat';
import type { RefundDecision, RefundResponse } from './application';
import {
  createConnectedApplication,
  type interruptsConnection,
} from './connection';

const suggestions = [
  {
    label: 'Refund a duplicate charge',
    value:
      'Refund $47.50 to customer cus_a8x2k — they were charged twice for the same order.',
  },
  {
    label: 'Refund a chargeback',
    value:
      'Refund $129.00 to customer cus_z19fp who opened a chargeback for unrecognized activity.',
  },
] as const;

function RefundApproval({
  decision,
  disabled,
  onDecide,
}: {
  readonly decision: RefundDecision;
  readonly disabled: boolean;
  readonly onDecide: (
    decision: RefundDecision,
    response: RefundResponse
  ) => void;
}) {
  const [edit, setEdit] = useState<{
    decision: RefundDecision;
    amount: string;
  } | null>(null);
  const editing = edit?.decision === decision;
  const amount = editing ? edit.amount : '';
  const valid =
    amount.trim().length > 0 &&
    Number.isFinite(Number(amount)) &&
    Number(amount) >= 0;
  const actions = editing
    ? [
        {
          id: 'edited',
          label: 'Approve edited amount',
          disabled: !valid,
          onSelect: () => {
            if (valid)
              onDecide(decision, { approved: true, amount: Number(amount) });
          },
        },
        {
          id: 'cancel-edit',
          label: 'Cancel edit',
          onSelect: () => setEdit(null),
        },
        {
          id: 'decline',
          label: "Don't refund",
          onSelect: () => onDecide(decision, { approved: false }),
        },
      ]
    : [
        {
          id: 'approve',
          label: 'Issue refund',
          onSelect: () => onDecide(decision, { approved: true }),
        },
        {
          id: 'edit',
          label: 'Edit amount',
          onSelect: () =>
            setEdit({ decision, amount: String(decision.refund.amount) }),
        },
        {
          id: 'decline',
          label: "Don't refund",
          onSelect: () => onDecide(decision, { approved: false }),
        },
      ];
  return (
    <ApprovalCard
      title="Refund approval required"
      disabled={disabled}
      actions={actions}
    >
      <dl>
        <dt>Amount</dt>
        <dd>${decision.refund.amount.toFixed(2)}</dd>
        <dt>Customer</dt>
        <dd>{decision.refund.customer_id}</dd>
        <dt>Reason</dt>
        <dd>{decision.refund.reason}</dd>
      </dl>
      {editing && (
        <label>
          Refund amount (USD)
          <input
            type="number"
            min="0"
            step="any"
            value={amount}
            disabled={disabled}
            onChange={(event) =>
              setEdit({ decision, amount: event.target.value })
            }
          />
        </label>
      )}
    </ApprovalCard>
  );
}

export function InterruptsDemo({
  connection,
  onReady,
}: {
  readonly connection: ReturnType<typeof interruptsConnection>;
  readonly onReady: () => void;
}) {
  const [application, setApplication] = useState(() =>
    createConnectedApplication(connection)
  );
  const [resetting, setResetting] = useState(false);
  const [generation, setGeneration] = useState(0);
  const live = useRef(true);
  const snapshot = useAgent(application);
  // Answered approvals stay in the transcript as one-line records.
  const [records, setRecords] = useState<readonly ApprovalRecordEntry[]>([]);
  // Answering removes the card and its focused button; focus returns to the
  // composer as soon as the composer is enabled again.
  const composer = useRef<ChatInputHandle>(null);
  const [focusOwed, setFocusOwed] = useState(false);
  const pending = snapshot.decision !== null;
  const composerDisabled = resetting || !snapshot.canSubmit;
  useEffect(() => {
    if (!focusOwed || pending || composerDisabled) return;
    setFocusOwed(false);
    composer.current?.focus();
  }, [focusOwed, pending, composerDisabled]);
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
    setRecords([]);
    setFocusOwed(false);
    setResetting(false);
  }
  const status = snapshot.busy
    ? snapshot.creation === 'pending'
      ? 'Creating conversation…'
      : snapshot.activity === 'decision'
      ? 'Sending decision…'
      : 'Receiving response…'
    : snapshot.decision
    ? 'Awaiting refund approval.'
    : snapshot.outcome === 'success' && snapshot.canSubmit
    ? 'Response complete.'
    : snapshot.outcome === 'aborted'
    ? 'Stopped. Start a new conversation to continue.'
    : !snapshot.canSubmit
    ? 'Start a new conversation to continue.'
    : 'Ready.';
  return (
    <ExampleLayout className="interrupts-demo">
      <header>
        <div>
          <h1>LangGraph interrupts</h1>
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
        Review a simulated refund, then approve, edit, or decline it. No real
        charge is issued.
      </p>
      {snapshot.creation === 'idle' && (
        <div className="suggestions">
          {suggestions.map((suggestion) => (
            <button
              type="button"
              key={suggestion.label}
              disabled={snapshot.busy || resetting}
              onClick={() => void application.submit(suggestion.value)}
            >
              {suggestion.label}
            </button>
          ))}
        </div>
      )}
      <MessageList
        rows={snapshot.rows}
        approvalRecords={records}
        label="Conversation"
      >
        {snapshot.decision && (
          <RefundApproval
            decision={snapshot.decision}
            disabled={snapshot.busy || resetting}
            onDecide={(decision, response) => {
              const before = application.getSnapshot();
              if (before.busy) return;
              const afterId = before.rows.at(-1)?.id;
              void application.decide(decision, response);
              // Record only a decision the application admitted.
              if (application.getSnapshot().activity !== 'decision') return;
              setRecords((previous) => [
                ...previous,
                {
                  afterId,
                  verdict: response.approved ? 'approved' : 'declined',
                  label: 'Issue refund',
                },
              ]);
              setFocusOwed(true);
            }}
          />
        )}
      </MessageList>
      <ExampleFooter>
        {snapshot.error && <p role="alert">{snapshot.error}</p>}
        <ChatInput
          ref={composer}
          key={generation}
          label="Message"
          placeholder="Describe a refund request…"
          disabled={composerDisabled}
          busy={snapshot.busy}
          onStop={snapshot.busy ? () => void application.stop() : undefined}
          onSubmit={(text) => {
            if (!application.getSnapshot().canSubmit) return false;
            void application.submit(text);
          }}
        />
        <p role="status">{status}</p>
      </ExampleFooter>
    </ExampleLayout>
  );
}
