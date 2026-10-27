import { useEffect, useState } from 'react';
import { useAgent } from '@threadplane/react';
import {
  ChatInput,
  ApprovalCard,
  MessageList,
  Reasoning,
  Citations,
} from '@threadplane/react/chat';
import { Markdown } from '@threadplane/react/markdown';
import type { MessageRow } from '@threadplane/content/messages';
import {
  createConnectedApplication,
  type interruptsConnection,
} from './connection';

/** Stable row renderer; the application owns Markdown snapshot lifetimes. */
export function renderMessage(row: MessageRow) {
  if (row.role === 'tool') return null;
  if (
    row.role === 'assistant' &&
    !row.message.content &&
    !row.reasoning &&
    !row.message.citations?.length &&
    row.message.toolCallIds?.length
  )
    return null;
  const label =
    row.role === 'user'
      ? 'You'
      : row.role === 'assistant'
      ? 'Assistant'
      : 'System';
  return (
    <article
      aria-label={label}
      className={`tp-chat-message tp-chat-message--${row.role}`}
    >
      <p className="tp-chat-message__role">{label}</p>
      {row.role === 'assistant' && row.reasoning && (
        <Reasoning snapshot={row.reasoning} />
      )}
      <Markdown snapshot={row.markdown} />
      {row.role === 'assistant' && row.message.citations && (
        <Citations citations={row.message.citations} />
      )}
    </article>
  );
}
export function InterruptsDemo({
  connection,
  onReady,
}: {
  readonly connection: ReturnType<typeof interruptsConnection>;
  readonly onReady: () => void;
}) {
  const [application] = useState(() => createConnectedApplication(connection));
  const [draft, setDraft] = useState('');
  const snapshot = useAgent(application),
    decision = snapshot.decision;
  useEffect(() => {
    onReady();
  }, [onReady]);
  useEffect(
    () => () => {
      void application.dispose();
    },
    [application]
  );
  const status = snapshot.busy
    ? snapshot.activity === 'creating'
      ? 'Creating conversation…'
      : snapshot.activity === 'confirming'
      ? 'Confirming saved conversation…'
      : snapshot.activity === 'replacing'
      ? 'Releasing conversation…'
      : 'Receiving response…'
    : decision
    ? 'Review this saved booking request.'
    : snapshot.outcome === 'success'
    ? 'Response saved.'
    : !snapshot.canSubmit
    ? 'Start a new conversation to continue.'
    : 'Ready.';
  const decide = (value: 'confirm' | 'cancel') => {
    const current = application.getSnapshot();
    if (!decision || current.busy || current.decision !== decision) return;
    void application.decide(decision, value);
  };
  return (
    <main className="interrupts-demo">
      <header>
        <div>
          <p className="eyebrow">React · Experimental</p>
          <h1>Chat interrupts</h1>
        </div>
        <button
          type="button"
          disabled={snapshot.busy}
          onClick={() => {
            if (application.getSnapshot().busy) return;
            setDraft('');
            void application.newConversation();
          }}
        >
          New conversation
        </button>
      </header>
      <p>
        Explore flight approvals with demo data. Confirm or cancel a saved
        booking request; no real ticket is purchased.
      </p>
      <div className="seed-prompts" aria-label="Example prompts">
        {['UA123', 'AA404'].map((flight) => (
          <button
            key={flight}
            type="button"
            disabled={!snapshot.canSubmit || snapshot.busy}
            onClick={() => {
              if (
                application.getSnapshot().canSubmit &&
                !application.getSnapshot().busy
              )
                setDraft(`Book flight ${flight}.`);
            }}
          >
            Book {flight}
          </button>
        ))}
      </div>
      <MessageList
        rows={snapshot.rows}
        renderMessage={renderMessage}
        label="Conversation"
      />
      {decision && (
        <ApprovalCard
          title="Approve demo booking"
          disabled={snapshot.busy}
          actions={[
            {
              id: 'confirm',
              label: 'Confirm',
              onSelect: () => decide('confirm'),
            },
            { id: 'cancel', label: 'Cancel', onSelect: () => decide('cancel') },
          ]}
        >
          <p>{decision.approval.summary}</p>
          <dl className="flight-details">
            <div>
              <dt>Flight</dt>
              <dd>{decision.approval.flight.flight_number}</dd>
            </div>
            <div>
              <dt>Airline</dt>
              <dd>{decision.approval.flight.airline}</dd>
            </div>
            <div>
              <dt>From</dt>
              <dd>{decision.approval.flight.from}</dd>
            </div>
            <div>
              <dt>To</dt>
              <dd>{decision.approval.flight.to}</dd>
            </div>
            <div>
              <dt>Departure</dt>
              <dd>{decision.approval.flight.depart_local}</dd>
            </div>
            <div>
              <dt>Aircraft</dt>
              <dd>{decision.approval.flight.aircraft}</dd>
            </div>
          </dl>
        </ApprovalCard>
      )}
      {snapshot.error && <p role="alert">{snapshot.error}</p>}
      <ChatInput
        key={snapshot.viewGeneration}
        label="Message"
        value={draft}
        onValueChange={setDraft}
        placeholder="Ask about a flight or request a booking…"
        hint="Enter to send. Shift+Enter adds a new line."
        busy={snapshot.busy}
        disabled={!snapshot.canSubmit && !snapshot.busy}
        onStop={
          snapshot.busy && snapshot.activity !== 'replacing'
            ? () => void application.stop()
            : undefined
        }
        onSubmit={(text) => {
          if (!application.getSnapshot().canSubmit) return false;
          void application.submit(text);
          return true;
        }}
      />
      <p role="status">{status}</p>
    </main>
  );
}
