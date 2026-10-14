import { useEffect, useLayoutEffect, useState } from 'react';
import { projectTextTranscript } from '@threadplane/ag-ui';
import { useAgent } from '@threadplane/react';
import {
  ApprovalCard,
  ChatInput,
  TextTranscript,
} from '@threadplane/react/chat';
import { createConnectedApplication, type mafConnection } from './connection';
import type { Expense } from './approval-policy';

export const EXPENSE_PRESET =
  'This is a fictional demo expense. Please look up the meals expense policy, then submit this expense for approval: Blue Finch Bistro, category meals, $220.00, memo: Team dinner for 4 attendees; receipt attached.';

function ExpenseDetails({
  expense,
}: {
  readonly expense: Readonly<Partial<Expense>>;
}) {
  return (
    <dl className="expense-details">
      <dt>Vendor</dt>
      <dd>{expense.vendor ?? 'Not provided'}</dd>
      <dt>Category</dt>
      <dd>{expense.category ?? 'Not provided'}</dd>
      <dt>Amount (USD)</dt>
      <dd>
        {expense.amount_usd === undefined
          ? 'Not provided'
          : `$${expense.amount_usd.toFixed(2)}`}
      </dd>
      <dt>Memo</dt>
      <dd>{expense.memo ?? 'Not provided'}</dd>
    </dl>
  );
}

export function MafDemo({
  connection,
  onReady,
}: {
  readonly connection: ReturnType<typeof mafConnection>;
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
    <MafPresentation
      application={application}
      label={owner.connection.label}
      onReady={onReady}
    />
  ) : (
    <p role="status">Starting expense preview…</p>
  );
}

function MafPresentation({
  application,
  label,
  onReady,
}: {
  readonly application: ReturnType<typeof createConnectedApplication>;
  readonly label: ReturnType<typeof mafConnection>['label'];
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
    running: 'Working on the expense…',
    pending: 'Awaiting your decision.',
    approved: 'Fictional expense approved.',
    declined: 'Expense declined.',
    unconfirmed: 'Expense unconfirmed. Start a new conversation.',
    replacing: 'Starting new conversation…',
    disposed: 'Preview closed.',
  }[snapshot.status];
  return (
    <main className="maf-demo">
      <header>
        <div>
          <p className="eyebrow">React · Experimental</p>
          <h1>Microsoft Agent Framework expenses</h1>
        </div>
        <button
          type="button"
          disabled={
            snapshot.status === 'replacing' || snapshot.status === 'disposed'
          }
          onClick={() => {
            void application.newConversation();
          }}
        >
          New conversation
        </button>
      </header>
      <p>
        Review a fictional expense, then approve or decline it. No real expense
        is submitted.
      </p>
      <p className="preview-note">Source-build preview · {label}</p>
      <button
        type="button"
        className="preset"
        disabled={!snapshot.canSend}
        onClick={() => setDraft(EXPENSE_PRESET)}
      >
        Team dinner for 4
      </button>
      <TextTranscript
        messages={projectTextTranscript(snapshot.rows)}
        label="Conversation"
      />
      {snapshot.draft && (
        <section
          aria-label="Predictive expense draft"
          className="predictive-draft"
        >
          <h2>Predictive expense draft</h2>
          <p>Read-only preview. Decisions use the separate expense approval.</p>
          <ExpenseDetails expense={snapshot.draft} />
        </section>
      )}
      {approval && (
        <ApprovalCard
          title="Expense approval"
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
          <ExpenseDetails expense={approval.expense} />
          <p>This decision applies only to the fictional expense shown here.</p>
        </ApprovalCard>
      )}
      {snapshot.result !== null && (
        <section
          aria-label="Observed backend result"
          className="backend-result"
        >
          <h2>Observed backend result</h2>
          <p>The expense tool returned this exact text:</p>
          <pre>{snapshot.result}</pre>
        </section>
      )}
      {snapshot.error && <p role="alert">{snapshot.error}</p>}
      <section aria-label="Compose message">
        <ChatInput
          label="Message"
          placeholder="Ask about a fictional expense…"
          value={draft}
          onValueChange={setDraft}
          disabled={!snapshot.canSend}
          busy={snapshot.busy}
          onStop={
            snapshot.busy && snapshot.status !== 'replacing'
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
