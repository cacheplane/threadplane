import { useCallback, useEffect, useState } from 'react';
import { useAgent } from '@threadplane/react';
import {
  ChatInput,
  ToolObservation,
  MessageList,
  Reasoning,
  Citations,
} from '@threadplane/react/chat';
import { Markdown } from '@threadplane/react/markdown';
import type { MessageRow } from '@threadplane/content/messages';
import {
  createConnectedApplication,
  type toolCallsConnection,
} from './connection';
import type { ToolCard } from './projection';

/** Stable row renderer; the application owns Markdown snapshot lifetimes. */
export function renderMessage(
  row: MessageRow,
  cards: readonly ToolCard[] = []
) {
  if (row.role === 'tool') return null;
  if (
    row.role === 'assistant' &&
    !row.message.content &&
    !row.reasoning &&
    !row.message.citations?.length &&
    !cards.length &&
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
      {cards.map((card) => (
        <div className="tool-observation" key={card.id}>
          <ToolObservation
            name={card.name}
            argumentsText={card.argumentsText}
            resultText={card.resultText}
            label={
              card.resultText === undefined
                ? 'Observed tool call'
                : 'Observed tool result'
            }
          />
        </div>
      ))}
      {row.role === 'assistant' && row.message.citations && (
        <Citations citations={row.message.citations} />
      )}
    </article>
  );
}
export function ToolCallsDemo({
  connection,
  onReady,
}: {
  readonly connection: ReturnType<typeof toolCallsConnection>;
  readonly onReady: () => void;
}) {
  const [application] = useState(() => createConnectedApplication(connection));
  const [draft, setDraft] = useState('');
  const snapshot = useAgent(application);
  const renderRow = useCallback(
    (row: MessageRow) => renderMessage(row, snapshot.observations.get(row.id)),
    [snapshot.observations]
  );
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
    : snapshot.outcome === 'success'
    ? 'Response saved.'
    : !snapshot.canSubmit
    ? 'Start a new conversation to continue.'
    : 'Ready.';
  return (
    <main className="tool-calls-demo">
      <header>
        <div>
          <p className="eyebrow">React · Experimental</p>
          <h1>Chat tool calls</h1>
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
        Explore read-only aviation tools with demo data. Inspect the observed
        arguments and results for each assistant request.
      </p>
      <div className="seed-prompts" aria-label="Example prompts">
        {[
          { label: 'Flight UA123', text: "What's the status of UA123?" },
          { label: 'Compare airports', text: 'Compare LAX and JFK airports.' },
          {
            label: 'Find routes',
            text: 'Find routes from LAX to JFK tomorrow.',
          },
        ].map((prompt) => (
          <button
            key={prompt.label}
            type="button"
            disabled={!snapshot.canSubmit || snapshot.busy}
            onClick={() => {
              if (
                application.getSnapshot().canSubmit &&
                !application.getSnapshot().busy
              )
                setDraft(prompt.text);
            }}
          >
            {prompt.label}
          </button>
        ))}
      </div>
      <MessageList
        rows={snapshot.rows}
        renderMessage={renderRow}
        label="Conversation"
      />
      {snapshot.error && <p role="alert">{snapshot.error}</p>}
      <ChatInput
        key={snapshot.viewGeneration}
        label="Message"
        value={draft}
        onValueChange={setDraft}
        placeholder="Ask about a flight, airport, or route…"
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
