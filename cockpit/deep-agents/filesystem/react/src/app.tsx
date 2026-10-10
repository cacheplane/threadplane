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
  type FilesystemConnection,
} from './connection';
import type { FilesystemApplicationSnapshot } from './application';
import { WorkspacePanel } from './workspace-panel';
import { ApprovalPanel } from './approval-panel';
const literal = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2);
export function renderMessage(
  row: MessageRow,
  snapshot: FilesystemApplicationSnapshot
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
                  ? 'Tool result received; workspace confirmation is shown separately.'
                  : `Observed tool: ${call.status}`
              }
            />
          </details>
        ))}
    </article>
  );
}
export function connectionFingerprint(connection: FilesystemConnection) {
  return JSON.stringify([
    connection.apiUrl,
    Object.entries(connection.headers).sort(([a], [b]) => a.localeCompare(b)),
  ]);
}
type Props = {
  readonly connection: FilesystemConnection;
  readonly onReady: () => void;
};
export function FilesystemDemo(props: Props) {
  const fingerprint = connectionFingerprint(props.connection),
    identity = useRef({ fingerprint, version: 0 });
  if (identity.current.fingerprint !== fingerprint)
    identity.current = { fingerprint, version: identity.current.version + 1 };
  return <FilesystemOwner key={identity.current.version} {...props} />;
}
function FilesystemOwner({ connection, onReady }: Props) {
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
      ? 'Confirming saved workspace…'
      : 'Receiving response…'
    : snapshot.phase === 'paused'
    ? 'Awaiting approval.'
    : snapshot.phase === 'saved'
    ? 'Response saved.'
    : snapshot.phase === 'stopped'
    ? 'Response stopped.'
    : snapshot.phase === 'unconfirmed'
    ? 'Workspace update unconfirmed.'
    : snapshot.phase === 'failed'
    ? 'Response failed.'
    : 'Ready.';
  return (
    <main className="filesystem-demo">
      <header>
        <div>
          <p className="eyebrow">React · Deep Agents</p>
          <h1>A workspace for the flight ahead.</h1>
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
        Build a runway note using fixed aviation lookup data. Read actual files
        and review proposed report changes before they run.
      </p>
      <div className="filesystem-layout">
        <section className="conversation-panel" aria-label="Chat">
          <div className="seed-prompts" aria-label="Example prompts">
            {[
              {
                label: 'Runway note for KASE',
                text: 'Work up a runway suitability note for KASE. Save your raw lookups to /notes/kase-data.md, then write the finished note to /reports/kase-runway.md.',
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
            placeholder="Ask for a runway note…"
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
        <div className="workspace-column">
          <WorkspacePanel
            key={`workspace:${snapshot.viewGeneration}`}
            observed={snapshot.observedWorkspace}
            saved={snapshot.savedWorkspace}
            phase={snapshot.phase}
            notice={snapshot.notice}
          />
          <ApprovalPanel
            approval={snapshot.approval}
            workspace={snapshot.savedWorkspace}
            busy={snapshot.busy}
            onDecision={(choice) => {
              const current = application.getSnapshot();
              if (
                currentView() &&
                !current.busy &&
                current.phase === 'paused' &&
                current.approval === snapshot.approval
              )
                void application.decide(choice, snapshot.decisionToken);
            }}
          />
        </div>
      </div>
    </main>
  );
}
