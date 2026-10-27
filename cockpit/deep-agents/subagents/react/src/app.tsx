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
  type subagentsConnection,
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
        <div className="tool-observation" data-call-id={card.id} key={card.id}>
          <h3>{card.subagentType ?? card.name}</h3>
          {card.kind === 'task' && card.fields === 'unavailable' && (
            <p>Task fields unavailable</p>
          )}
          {card.description !== undefined && <p>{card.description}</p>}
          <p>
            {card.resultStatus === 'error'
              ? 'Tool result: error'
              : `Observed delivery: ${card.status}`}
          </p>
          <ToolObservation
            name={card.name}
            argumentsText={card.argumentsText}
            resultText={card.resultText}
            label={
              card.resultText === undefined
                ? card.kind === 'task'
                  ? 'Observed specialist request'
                  : 'Observed tool request'
                : card.resultStatus === 'error'
                ? 'Observed tool error'
                : card.kind === 'task'
                ? 'Observed specialist result'
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
export function SubagentsDemo({
  connection,
  onReady,
}: {
  readonly connection: ReturnType<typeof subagentsConnection>;
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
    : snapshot.outcome === 'aborted'
    ? 'Response stopped. Start a new conversation to continue.'
    : !snapshot.canSubmit
    ? 'Start a new conversation to continue.'
    : 'Ready.';
  return (
    <main className="subagents-demo">
      <header>
        <div>
          <p className="eyebrow">React · Experimental</p>
          <h1>Deep Agents subagents</h1>
        </div>
        <button
          type="button"
          onClick={() => {
            setDraft('');
            void application.newConversation();
          }}
        >
          New conversation
        </button>
      </header>
      <p>
        Dispatch sample field research and weather tasks, and inspect separate
        native child streams. Aviation lookups use fixed sample data, including
        weather. Stop cancels local delivery; it does not roll back backend
        work.
      </p>
      <div className="seed-prompts" aria-label="Example prompts">
        {[
          {
            label: 'Brief KASE and KDEN',
            text: 'Brief me on KASE and KDEN: I need field data for both and the current weather at both.',
          },
          {
            label: 'Field data for KSFO',
            text: 'What is the field data for KSFO?',
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
      <aside aria-label="Specialist roster">
        field-researcher · weather-analyst
      </aside>
      <p aria-label="Observed dispatch count">
        {snapshot.taskCount === null
          ? 'Dispatch observations incomplete'
          : `${snapshot.taskCount} observed task dispatches`}
      </p>
      <MessageList
        rows={snapshot.rows}
        renderMessage={renderRow}
        label="Conversation"
      />
      {snapshot.childObservations.length > 0 && (
        <details className="child-observations">
          <summary>Child response observations</summary>
          <p>
            Local observations from this open conversation. These are not
            restored execution history and are not linked to individual task
            cards.
          </p>
          {snapshot.childObservations.map((child, index) => (
            <section key={child.key} aria-label={`Observed namespace response`}>
              <h3>Observed stream {index + 1}</h3>
              <p className="namespace">{JSON.stringify(child.namespace)}</p>
              <p className="child-observation-status">{child.status}</p>
              <details open>
                <summary>Observed transcript</summary>
                <pre>{child.text}</pre>
              </details>
            </section>
          ))}
        </details>
      )}
      {snapshot.error && <p role="alert">{snapshot.error}</p>}
      <ChatInput
        key={snapshot.viewGeneration}
        label="Message"
        value={draft}
        onValueChange={setDraft}
        placeholder="Ask about field data or weather…"
        hint="Enter to send. Shift+Enter adds a new line."
        busy={snapshot.busy}
        disabled={!snapshot.canSubmit && !snapshot.busy}
        onStop={
          snapshot.busy && snapshot.activity !== 'replacing'
            ? () => void application.stop()
            : undefined
        }
        onSubmit={(text) => {
          if (
            !application.getSnapshot().canSubmit ||
            application.getSnapshot().busy ||
            !text.trim()
          )
            return false;
          void application.submit(text);
          return true;
        }}
      />
      <p role="status">{status}</p>
    </main>
  );
}
