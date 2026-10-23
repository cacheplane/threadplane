import { useCallback, useEffect, useState } from 'react';
import { useAgent } from '@threadplane/react';
import {
  ChatInput,
  MessageList,
  ToolObservation,
  Reasoning,
  Citations,
} from '@threadplane/react/chat';
import { Markdown } from '@threadplane/react/markdown';
import type { MessageRow } from '@threadplane/content/messages';
import { MEMORY_PATH, type MemoryProjection } from './memory-projection';
import { copyData, LIMITS, type Authority } from './authority';
import {
  createConnectedApplication,
  type memoryConnection,
} from './connection';

function literal(value: unknown): string {
  try {
    const copied = copyData(value);
    const text =
      typeof copied === 'string'
        ? copied
        : JSON.stringify(copied, null, 2) ?? '';
    return text.length <= LIMITS.fieldText
      ? text
      : 'Observation text unavailable: display limit exceeded.';
  } catch {
    return 'Observation text unavailable.';
  }
}

/** Application owns row Markdown snapshots and tool/result association. */
export function renderMessage(
  row: MessageRow,
  authority: Authority = { kind: 'unconfirmed' }
) {
  if (row.role === 'tool') return null;
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
      {row.toolCalls.map((call) => {
        const error =
          call.status === 'error' ||
          (authority.kind === 'terminal' &&
            authority.rawToolStatuses[call.id] === 'error');
        return (
          <div
            key={call.id}
            className="tool-observation"
            data-call-id={call.id}
          >
            <p>
              {error
                ? 'Tool result: error'
                : `Observed delivery: ${call.status}`}
            </p>
            <ToolObservation
              name={call.name}
              argumentsText={literal(call.args)}
              resultText={
                call.status === 'complete'
                  ? literal(call.result)
                  : call.status === 'error'
                  ? literal(call.error)
                  : undefined
              }
              label={error ? 'Observed tool error' : 'Observed tool delivery'}
            />
          </div>
        );
      })}
      {row.role === 'assistant' && row.message.citations && (
        <Citations citations={row.message.citations} />
      )}
    </article>
  );
}

export function MemoryPanel({ memory }: { memory: MemoryProjection }) {
  return (
    <section aria-label="Agent Memory" className="memory-panel">
      <h2>Agent Memory</h2>
      <p data-testid="memory-source" data-source={memory.kind}>
        {memory.kind === 'live'
          ? 'store observed during this run'
          : memory.kind === 'checkpoint'
          ? 'confirmed checkpoint at read time'
          : memory.kind === 'unavailable'
          ? 'memory observation unavailable'
          : 'no source yet'}
      </p>
      {(memory.kind === 'live' || memory.kind === 'checkpoint') &&
        (memory.file === 'missing' ? (
          <p>No memory file at this observation’s read time.</p>
        ) : (
          <div data-testid="memory-file">
            <h3>
              <code>{MEMORY_PATH}</code>
            </h3>
            {memory.contents === '' && (
              <p>The memory file is present and empty.</p>
            )}
            <pre>{memory.contents}</pre>
          </div>
        ))}
      <p>
        This panel shows one browser identity’s store at an observed read time.
        New conversations share that identity while browser storage is
        available. Checkpoints are historical; observations do not promise
        durability or that the store is current. Concurrent conversations are
        not serialized.
      </p>
    </section>
  );
}

export function MemoryDemo({
  connection,
  onReady,
}: {
  connection: ReturnType<typeof memoryConnection>;
  onReady: () => void;
}) {
  const [application] = useState(() => createConnectedApplication(connection));
  const [draft, setDraft] = useState('');
  const snapshot = useAgent(application);
  const renderRow = useCallback(
    (row: MessageRow) => renderMessage(row, snapshot.authority),
    [snapshot.authority]
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
  useEffect(() => {
    setDraft('');
  }, [snapshot.viewGeneration]);
  const status = snapshot.busy
    ? snapshot.activity === 'confirming'
      ? 'Confirming saved conversation…'
      : snapshot.activity === 'restoring'
      ? 'Restoring conversation…'
      : snapshot.activity === 'creating'
      ? 'Creating conversation…'
      : 'Receiving response…'
    : !snapshot.canSubmit
    ? snapshot.scopeWarning
      ? 'Sending is unavailable. Reload after checking browser storage.'
      : 'Start a new conversation to continue.'
    : snapshot.outcome === 'success' &&
      snapshot.authority.kind === 'terminal' &&
      snapshot.memory.kind === 'checkpoint'
    ? 'Response saved.'
    : 'Ready.';
  return (
    <main className="memory-demo">
      <header>
        <div>
          <p className="eyebrow">React · Experimental</p>
          <h1>Deep Agents Memory</h1>
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
        Teach the agent about your operation, then start a new conversation and
        ask what it remembers. Stop cancels local delivery; backend work may
        continue.
      </p>
      <div className="seed-prompts" aria-label="Example prompts">
        <button
          type="button"
          disabled={snapshot.busy || !snapshot.canSubmit}
          onClick={() => {
            const current = application.getSnapshot();
            if (current.canSubmit && !current.busy)
              setDraft(
                'I fly a Citation CJ3 out of KASE, and I always want briefings in bullet points. Please remember that.'
              );
          }}
        >
          Teach
        </button>
        <button
          type="button"
          disabled={snapshot.busy || !snapshot.canSubmit}
          onClick={() => {
            const current = application.getSnapshot();
            if (current.canSubmit && !current.busy)
              setDraft('What do you already know about my operation?');
          }}
        >
          Recall
        </button>
      </div>
      <label>
        Saved conversations{' '}
        <select
          aria-label="Saved conversations"
          value={snapshot.threadId ?? ''}
          disabled={snapshot.busy}
          onChange={(event) => {
            if (!event.target.value) return;
            setDraft('');
            void application.selectConversation(event.target.value);
          }}
        >
          <option value="">Choose a saved conversation</option>
          {snapshot.history.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      <div className="memory-workspace">
        <div className="memory-chat">
          <MessageList
            rows={snapshot.rows}
            renderMessage={renderRow}
            label="Conversation"
          />
          {snapshot.scopeWarning && (
            <p role="alert" data-testid="memory-scope-warning">
              {snapshot.scopeWarning}
            </p>
          )}
          {snapshot.error && <p role="alert">{snapshot.error}</p>}
          <ChatInput
            key={snapshot.viewGeneration}
            label="Message"
            value={draft}
            onValueChange={setDraft}
            placeholder="Teach the agent or ask what it remembers…"
            hint="Enter to send. Shift+Enter adds a new line."
            busy={snapshot.busy}
            disabled={!snapshot.canSubmit && !snapshot.busy}
            onStop={snapshot.busy ? () => void application.stop() : undefined}
            onSubmit={(text) => {
              const current = application.getSnapshot();
              if (!current.canSubmit || current.busy || !text.trim())
                return false;
              void application.submit(text);
              return true;
            }}
          />
          <p role="status">{status}</p>
        </div>
        <aside className="memory-sidebar" aria-label="Memory sidebar">
          <MemoryPanel memory={snapshot.memory} />
        </aside>
      </div>
    </main>
  );
}
