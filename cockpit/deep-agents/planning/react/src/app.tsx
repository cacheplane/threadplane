import { useCallback, useEffect, useRef, useState } from 'react';
import { useAgent } from '@threadplane/react';
import {
  ChatInput,
  MessageList,
  Reasoning,
  ToolObservation,
} from '@threadplane/react/chat';
import { Markdown } from '@threadplane/react/markdown';
import type { MessageRow } from '@threadplane/content/messages';
import {
  createConnectedApplication,
  type PlanningConnection,
} from './connection';
import type { PlanningApplicationSnapshot } from './application';
import { PlanPanel } from './plan-panel';
const literal = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2);
export function renderMessage(
  row: MessageRow,
  snapshot: PlanningApplicationSnapshot
) {
  const label =
    row.role === 'user'
      ? 'You'
      : row.role === 'assistant'
      ? 'Assistant'
      : row.role === 'tool'
      ? 'Tool result'
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
      {row.role === 'tool' ? (
        <details>
          <summary>Tool result received</summary>
          <pre>{row.message.content}</pre>
        </details>
      ) : (
        <Markdown snapshot={row.markdown} />
      )}
      {snapshot.toolCalls
        .filter((call) => row.message.toolCallIds?.includes(call.id))
        .map((call) => (
          <details key={call.id} className="tool-inspection">
            <summary>
              {call.name} ·{' '}
              {call.status === 'complete' ? 'result received' : call.status}
            </summary>
            <ToolObservation
              name={call.name}
              argumentsText={literal(call.args) ?? ''}
              resultText={
                call.status === 'complete'
                  ? literal(call.result)
                  : call.status === 'error'
                  ? call.error
                  : undefined
              }
              label={
                call.status === 'complete'
                  ? 'Tool result received; plan confirmation is shown separately.'
                  : `Observed tool: ${call.status}`
              }
            />
          </details>
        ))}
    </article>
  );
}
export function connectionFingerprint(connection: PlanningConnection) {
  return JSON.stringify([
    connection.apiUrl,
    Object.entries(connection.headers).sort(([a], [b]) => a.localeCompare(b)),
  ]);
}
type Props = {
  readonly connection: PlanningConnection;
  readonly onReady: () => void;
};
export function PlanningDemo(props: Props) {
  const fingerprint = connectionFingerprint(props.connection),
    identity = useRef({ fingerprint, version: 0 });
  if (identity.current.fingerprint !== fingerprint)
    identity.current = { fingerprint, version: identity.current.version + 1 };
  return <PlanningOwner key={identity.current.version} {...props} />;
}
function PlanningOwner({ connection, onReady }: Props) {
  const [application] = useState(() => createConnectedApplication(connection)),
    [draft, setDraft] = useState(''),
    snapshot = useAgent(application);
  useEffect(() => {
    onReady();
  }, [onReady]);
  useEffect(
    () => () => {
      void application.dispose();
    },
    [application]
  );
  const renderRow = useCallback(
    (row: MessageRow) => renderMessage(row, snapshot),
    [snapshot]
  );
  const currentView = () =>
    application.getSnapshot().viewGeneration === snapshot.viewGeneration;
  const status = snapshot.busy
    ? snapshot.phase === 'confirming'
      ? 'Confirming saved plan…'
      : 'Receiving response…'
    : snapshot.phase === 'saved'
    ? 'Response saved.'
    : snapshot.phase === 'stopped'
    ? 'Response stopped.'
    : snapshot.phase === 'unconfirmed'
    ? 'Plan update unconfirmed.'
    : snapshot.phase === 'failed'
    ? 'Response failed.'
    : 'Ready.';
  return (
    <main className="planning-demo">
      <header>
        <div>
          <p className="eyebrow">React · Deep Agents</p>
          <h1>A plan for the flight ahead.</h1>
        </div>
        <button
          type="button"
          onClick={() => {
            if (currentView()) {
              setDraft('');
              void application.newConversation();
            }
          }}
        >
          New conversation
        </button>
      </header>
      <p className="introduction">
        Build a dispatch brief using fixed aviation lookup data. Watch the
        assistant build and revise its plan alongside the conversation.
      </p>
      <div className="planning-layout">
        <section className="conversation-panel" aria-label="Chat">
          <div className="seed-prompts" aria-label="Example prompts">
            {[
              {
                label: 'Dispatch brief: KSFO to KASE',
                text: 'Plan a dispatch brief for a flight from KSFO to KASE: check field elevation, runway length, and weather at both ends, then tell me if there is anything the crew should know.',
              },
            ].map((prompt) => (
              <button
                key={prompt.label}
                type="button"
                disabled={snapshot.busy || !snapshot.canSubmit}
                onClick={() => {
                  const current = application.getSnapshot();
                  if (currentView() && !current.busy && current.canSubmit)
                    setDraft(prompt.text);
                }}
              >
                {prompt.label}
              </button>
            ))}
          </div>
          {!snapshot.rows.length && (
            <div className="conversation-empty">
              <span aria-hidden="true">↗</span>
              <h2>Start with what you want to do.</h2>
              <p>
                A message creates your conversation. Suggestions just fill the
                draft.
              </p>
            </div>
          )}
          <MessageList
            key={`messages:${snapshot.viewGeneration}`}
            rows={snapshot.rows}
            renderMessage={renderRow}
            label="Conversation"
          />
          {snapshot.error && (
            <p role="alert" className="request-error">
              {snapshot.error}
            </p>
          )}
          <ChatInput
            key={`composer:${snapshot.viewGeneration}`}
            label="Message"
            value={draft}
            onValueChange={(text) => {
              if (currentView()) setDraft(text);
            }}
            placeholder="Ask for a dispatch brief…"
            hint="Enter to send. Shift+Enter adds a new line."
            busy={snapshot.busy}
            disabled={snapshot.busy || !snapshot.canSubmit}
            onStop={
              snapshot.busy
                ? () => {
                    if (currentView()) void application.stop();
                  }
                : undefined
            }
            onSubmit={(text) => {
              const current = application.getSnapshot();
              if (
                !currentView() ||
                current.busy ||
                !current.canSubmit ||
                !text.trim()
              )
                return false;
              void application.submit(text);
              return currentView() && application.getSnapshot().busy;
            }}
          />
          <p role="status" className="response-status">
            {status}
          </p>
        </section>
        <PlanPanel
          observed={snapshot.observedPlan}
          saved={snapshot.savedPlan}
          phase={snapshot.phase}
          notice={snapshot.notice}
        />
      </div>
    </main>
  );
}
