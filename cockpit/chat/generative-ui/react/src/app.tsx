// eslint-disable-next-line @nx/enforce-module-boundaries -- The isolated consumer copies this internal example layout.
import { ExampleFooter, ExampleLayout } from '../../../../shared/react-example';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAgent } from '@threadplane/react';
import {
  ChatInput,
  MessageList,
  Reasoning,
  ToolActivityGroup,
  toolActivityPhase,
  type ChatInputHandle,
} from '@threadplane/react/chat';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Pure metadata copied into the isolated consumer.
import { exampleToolLabel } from '../../../../shared/tool-presentation';
import { Markdown } from '@threadplane/react/markdown';
import { RenderSpec, type RenderSpecProps } from '@threadplane/react/render';
import type { MessageRow } from '@threadplane/content/messages';
import {
  createConnectedApplication,
  type GenerativeUiConnection,
} from './connection';
import type { GenerativeUiSnapshot } from './application';
import { dashboardRegistry } from './dashboard-views';

function UnsupportedView() {
  return <p role="alert">This dashboard view is unavailable.</p>;
}
const literal = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2);
/** Layout authority belongs to the confirmed parent; data is shared by every retained layout. */
export function renderMessage(row: MessageRow, snapshot: GenerativeUiSnapshot) {
  const surface = snapshot.surfaces.find((item) => item.messageId === row.id);
  const notice = snapshot.notices.find((item) => item.messageId === row.id);
  const calls = snapshot.toolCalls.filter((call) =>
    row.message.toolCallIds?.includes(call.id)
  );
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
      {calls.length > 0 && (
        <ToolActivityGroup
          label="Airline data activity"
          activities={calls.map((call) => ({
            id: call.id,
            name: call.name,
            label: exampleToolLabel(call.name),
            phase: toolActivityPhase(call.status, row.message.delivery),
            argumentsText: literal(call.args) ?? '',
            resultText:
              call.status === 'complete' ? literal(call.result) : undefined,
            errorText: call.status === 'error' ? call.error : undefined,
          }))}
        />
      )}
      {surface ? null : row.role === 'tool' ? (
        <details>
          <summary>Details</summary>
          <p>Server tool result</p>
          <pre>{row.message.content}</pre>
        </details>
      ) : (
        <Markdown snapshot={row.markdown} />
      )}
      {surface && (
        <div data-dashboard-spec-owner={row.id}>
          <RenderSpec
            spec={surface.spec}
            registry={dashboardRegistry}
            state={snapshot.dashboard as RenderSpecProps['state']}
            loading={snapshot.busy}
            fallback={UnsupportedView}
          />
        </div>
      )}
      {surface && (
        <details>
          <summary>Details</summary>
          <p>Layout source</p>
          <pre>{row.message.content}</pre>
        </details>
      )}
      {notice && <p role="status">{notice.text}</p>}
    </article>
  );
}
type Props = {
  readonly connection: GenerativeUiConnection;
  readonly onReady: () => void;
};
/** Replace the owner on connection changes without putting credentials in React keys. */
export function GenerativeUiDemo(props: Props) {
  const fingerprint = JSON.stringify([
    props.connection.apiUrl,
    Object.entries(props.connection.headers).sort(([a], [b]) =>
      a.localeCompare(b)
    ),
  ]);
  const identity = useRef({ fingerprint, version: 0 });
  if (identity.current.fingerprint !== fingerprint)
    identity.current = { fingerprint, version: identity.current.version + 1 };
  return <GenerativeUiOwner key={identity.current.version} {...props} />;
}
function GenerativeUiOwner({ connection, onReady }: Props) {
  const [application] = useState(() => createConnectedApplication(connection));
  const [draft, setDraft] = useState('');
  const composer = useRef<ChatInputHandle>(null);
  const resetButton = useRef<HTMLButtonElement>(null);
  const focusAfterReset = useRef(false);
  const snapshot = useAgent(application);
  useEffect(() => {
    if (!focusAfterReset.current || snapshot.busy) return;
    focusAfterReset.current = false;
    const document = resetButton.current?.ownerDocument;
    if (
      document &&
      (document.activeElement === resetButton.current ||
        document.activeElement === document.body)
    ) {
      composer.current?.focus();
    }
  }, [snapshot.viewGeneration, snapshot.busy]);
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
    ? snapshot.activity === 'creating'
      ? 'Creating conversation…'
      : snapshot.activity === 'confirming'
      ? 'Confirming saved dashboard…'
      : snapshot.activity === 'replacing'
      ? 'Releasing conversation…'
      : 'Receiving response…'
    : !snapshot.canSubmit
    ? 'Start a new conversation to continue.'
    : snapshot.outcome === 'success'
    ? 'Response saved.'
    : 'Ready.';
  return (
    <ExampleLayout className="dashboard-demo">
      <header>
        <div>
          <h1>Chat generative UI</h1>
        </div>
        <button
          ref={resetButton}
          type="button"
          onClick={() => {
            if (currentView()) {
              focusAfterReset.current = true;
              setDraft('');
              void application.newConversation();
            }
          }}
        >
          New conversation
        </button>
      </header>
      <p>
        Explore airline operations with fixture data. Confirmed dashboards stay
        in the conversation and refresh together when a new update is saved.
      </p>
      {snapshot.rows.length === 0 && (
        <div className="seed-prompts" aria-label="Example prompts">
          {[
            {
              label: 'Show dashboard',
              text: 'Show me a dashboard of airline operations.',
            },
            {
              label: 'Cancelled flights',
              text: 'Filter to only the cancelled flights.',
            },
          ].map((prompt) => (
            <button
              type="button"
              key={prompt.label}
              disabled={snapshot.busy || !snapshot.canSubmit}
              onClick={() => {
                const current = application.getSnapshot();
                if (currentView() && !current.busy && current.canSubmit) {
                  setDraft(prompt.text);
                  composer.current?.focus();
                }
              }}
            >
              {prompt.label}
            </button>
          ))}
        </div>
      )}
      <MessageList
        key={`messages:${snapshot.viewGeneration}`}
        rows={snapshot.rows}
        renderMessage={renderRow}
        label="Conversation"
      />
      <ExampleFooter>
        {snapshot.error && <p role="alert">{snapshot.error}</p>}
        <ChatInput
          ref={composer}
          key={`composer:${snapshot.viewGeneration}`}
          label="Message"
          value={draft}
          onValueChange={(text) => {
            if (currentView()) setDraft(text);
          }}
          placeholder="Ask about airline operations…"
          hint="Enter to send. Shift+Enter adds a new line."
          busy={snapshot.busy}
          disabled={snapshot.busy || !snapshot.canSubmit}
          onStop={
            snapshot.busy && snapshot.activity !== 'replacing'
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
        <p role="status">{status}</p>
      </ExampleFooter>
    </ExampleLayout>
  );
}
