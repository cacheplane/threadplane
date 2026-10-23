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
import type { SkillIndex } from './index-projection';
import type { ReadProjection, SkillRead } from './read-projection';
import { copyData, LIMITS, type Authority } from './authority';
import {
  createConnectedApplication,
  type skillsConnection,
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

const readLabels: Record<SkillRead['kind'], string> = {
  pending: 'Read pending',
  unknown: 'Read status unknown',
  error: 'Read failed',
  unavailable: 'Read evidence unavailable',
  partial: 'Partially inspected',
  inspected: 'Inspected',
};
const hasReads = (value: ReadProjection): value is readonly SkillRead[] =>
  Array.isArray(value);
export function SkillPanels({
  index,
  reads,
}: {
  index: SkillIndex;
  reads: ReadProjection;
}) {
  return (
    <div className="skill-panels">
      <section aria-label="Skills index">
        <h2>Skills index</h2>
        <p>
          The index shows names, descriptions, virtual instruction paths, and
          optional support annotations. Metadata does not establish that
          instructions were read.
        </p>
        {index.kind === 'ready' ? (
          <>
            <p data-testid="skills-source" data-source={index.source}>
              {index.source === 'checkpoint'
                ? 'Confirmed checkpoint'
                : 'Observed root values'}
            </p>
            {!index.skills.length && <p>The skills index is empty.</p>}
            {index.skills.map((skill) => (
              <article key={skill.path}>
                <h3>{skill.name}</h3>
                <p>{skill.description}</p>
                <code>{skill.path}</code>
                {(skill.license !== undefined ||
                  skill.compatibility !== undefined ||
                  skill.allowed_tools !== undefined ||
                  skill.metadata !== undefined) && (
                  <details>
                    <summary>Skill metadata</summary>
                    {skill.license !== undefined && (
                      <p>License: {skill.license ?? 'unspecified'}</p>
                    )}
                    {skill.compatibility !== undefined && (
                      <p>
                        Compatibility: {skill.compatibility ?? 'unspecified'}
                      </p>
                    )}
                    {skill.allowed_tools !== undefined && (
                      <p>
                        Allowed tools:{' '}
                        {skill.allowed_tools.join(', ') || 'none listed'}
                      </p>
                    )}
                    {skill.metadata && <pre>{literal(skill.metadata)}</pre>}
                  </details>
                )}
              </article>
            ))}
          </>
        ) : (
          <p>
            {index.kind === 'absent'
              ? 'No skills index observed.'
              : index.kind === 'stale'
              ? 'Skills index belongs to an earlier conversation.'
              : 'Skills index unavailable.'}
          </p>
        )}
      </section>
      <section aria-label="Skill read observations">
        <h2>Skill read observations</h2>
        <p>
          Instruction bodies and references are read on demand during a
          response. Inspected describes observed read evidence; it does not
          imply the whole file was read.
        </p>
        {hasReads(reads) ? (
          !reads.length ? (
            <p>No associated skill reads observed.</p>
          ) : (
            reads.map((read) => (
              <article key={read.id} data-read-kind={read.kind}>
                <h3>{read.skillName}</h3>
                <p>
                  Read call: <code>{read.id}</code>
                </p>
                <p>
                  {read.category === 'instruction'
                    ? 'Skill instruction'
                    : 'Skill reference'}
                </p>
                <code>{read.path}</code>
                <p>{readLabels[read.kind]}</p>
                {read.empty && <p>An empty-file reminder was observed.</p>}
                {read.result !== undefined && (
                  <details>
                    <summary>Literal read result</summary>
                    <pre>{read.result}</pre>
                  </details>
                )}
              </article>
            ))
          )
        ) : (
          <p>Read observations unavailable.</p>
        )}
      </section>
    </div>
  );
}

export function SkillsDemo({
  connection,
  onReady,
}: {
  connection: ReturnType<typeof skillsConnection>;
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
    ? 'Start a new conversation to continue.'
    : snapshot.outcome === 'success'
    ? 'Response saved.'
    : 'Ready.';
  return (
    <main className="skills-demo">
      <header>
        <div>
          <p className="eyebrow">React · Experimental</p>
          <h1>Deep Agents skills</h1>
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
        Inspect progressive disclosure of skill metadata, instructions, and
        reference files. Aviation examples use fixed sample data. Stop cancels
        local delivery; backend work may continue.
      </p>
      <div className="seed-prompts" aria-label="Example prompts">
        <button
          type="button"
          disabled={snapshot.busy || !snapshot.canSubmit}
          onClick={() => {
            const current = application.getSnapshot();
            if (current.canSubmit && !current.busy)
              setDraft('Can a mid-size jet operate out of KASE?');
          }}
        >
          Mid-size jet at KASE
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
      <div className="skills-workspace">
        <div className="skills-chat">
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
            placeholder="Ask about aircraft and runway requirements…"
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
        <aside className="skills-sidebar" aria-label="Skills sidebar">
          <SkillPanels index={snapshot.index} reads={snapshot.reads} />
        </aside>
      </div>
    </main>
  );
}
