// eslint-disable-next-line @nx/enforce-module-boundaries -- The isolated consumer copies this internal example layout.
import { ExampleFooter, ExampleLayout } from '../../../../shared/react-example';
import { useEffect, useRef, useState } from 'react';
import { useAgent } from '@threadplane/react';
import {
  ChatInput,
  ApprovalCard,
  MessageList,
  Reasoning,
  Citations,
  type ApprovalRecordEntry,
  type ChatInputHandle,
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
  // Answered approvals stay in the transcript as one-line records.
  const [records, setRecords] = useState<readonly ApprovalRecordEntry[]>([]);
  // Answering removes the card and its focused button; focus returns to the
  // composer as soon as the composer is enabled again.
  const composer = useRef<ChatInputHandle>(null);
  const [focusOwed, setFocusOwed] = useState(false);
  const composerDisabled = !snapshot.canSubmit && !snapshot.busy;
  useEffect(() => {
    if (!focusOwed || decision || composerDisabled) return;
    setFocusOwed(false);
    composer.current?.focus();
  }, [focusOwed, decision, composerDisabled]);
  useEffect(() => {
    setRecords([]);
    setFocusOwed(false);
  }, [snapshot.viewGeneration]);
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
    // Record only a decision the application admitted.
    if (application.getSnapshot().decision === decision) return;
    setRecords((previous) => [
      ...previous,
      {
        afterId: current.rows.at(-1)?.id,
        verdict: value === 'confirm' ? 'approved' : 'declined',
        label: 'Book flight',
      },
    ]);
    setFocusOwed(true);
  };
  return (
    <ExampleLayout className="interrupts-demo">
      <header>
        <div>
          <h1>Chat interrupts</h1>
        </div>
        <button
          type="button"
          disabled={snapshot.busy}
          onClick={() => {
            if (application.getSnapshot().busy) return;
            setDraft('');
            setRecords([]);
            setFocusOwed(false);
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
        running={
          snapshot.activity === 'creating' || snapshot.activity === 'running'
        }
        typingIndicator={{ announce: false }}
        rows={snapshot.rows}
        renderMessage={renderMessage}
        approvalRecords={records}
        label="Conversation"
      >
        {decision && (
          <ApprovalCard
            title="Approve demo booking"
            disabled={snapshot.busy}
            actions={[
              {
                id: 'confirm',
                label: 'Book flight',
                onSelect: () => decide('confirm'),
              },
              {
                id: 'cancel',
                label: "Don't book",
                onSelect: () => decide('cancel'),
              },
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
      </MessageList>
      <ExampleFooter>
        {snapshot.error && <p role="alert">{snapshot.error}</p>}
        <ChatInput
          ref={composer}
          key={snapshot.viewGeneration}
          label="Message"
          value={draft}
          onValueChange={setDraft}
          placeholder="Ask about a flight or request a booking…"
          hint="Enter to send. Shift+Enter adds a new line."
          busy={snapshot.busy}
          disabled={composerDisabled}
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
      </ExampleFooter>
    </ExampleLayout>
  );
}
