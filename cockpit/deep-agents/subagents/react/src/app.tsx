// eslint-disable-next-line @nx/enforce-module-boundaries -- The isolated consumer copies this internal example layout.
import { ExampleLayout } from '../../../../shared/react-example';
import { useEffect, useMemo, useState } from 'react';
import { useAgent } from '@threadplane/react';
import {
  Chat,
  WelcomeSuggestion,
  type SubagentInfo,
} from '@threadplane/react/chat';
import {
  createConnectedApplication,
  type subagentsConnection,
} from './connection';
import type { ToolCard } from './projection';

const SUGGESTIONS = [
  {
    label: 'Brief KASE and KDEN',
    value:
      'Brief me on KASE and KDEN: I need field data for both and the current weather at both.',
  },
  { label: 'Field data for KSFO', value: 'What is the field data for KSFO?' },
] as const;

/**
 * Each observed `task` dispatch as a subagent card in place of its call. The
 * card shows the parent's literal request and result; child streams are not
 * linked to individual dispatches, so they stay in their own panel below.
 */
export function subagentCards(
  observations: ReadonlyMap<string, readonly ToolCard[]>
): readonly SubagentInfo[] {
  return [...observations.values()].flatMap((cards) =>
    cards
      .filter((card) => card.kind === 'task')
      .map(
        (card): SubagentInfo => ({
          id: card.id,
          toolCallId: card.id,
          name: card.subagentType ?? card.name,
          description:
            card.fields === 'unavailable'
              ? 'Task fields unavailable'
              : card.description,
          status:
            card.resultStatus === 'error'
              ? 'error'
              : card.status === 'complete' ||
                card.status === 'running' ||
                card.status === 'pending'
              ? card.status
              : 'unknown',
          messages:
            card.resultText === undefined
              ? []
              : [{ id: `${card.id}:result`, text: card.resultText }],
          ...(card.resultStatus === 'error'
            ? { errorSummary: 'The specialist returned an error.' }
            : {}),
        })
      )
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
  const snapshot = useAgent(application);
  // Stable between observations, as MessageList asks of `subagents`.
  const subagents = useMemo(
    () => subagentCards(snapshot.observations),
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
    <ExampleLayout className="subagents-demo">
      <header>
        <div>
          <h1>Deep Agents subagents</h1>
        </div>
        <button
          type="button"
          onClick={() => {
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
      <aside aria-label="Specialist roster">
        field-researcher · weather-analyst
      </aside>
      <p aria-label="Observed dispatch count">
        {snapshot.taskCount === null
          ? 'Dispatch observations incomplete'
          : `${snapshot.taskCount} observed task dispatches`}
      </p>
      {/* Child streams are not linked to dispatches, so they stay beside the transcript. */}
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
      {/*
        Chat's defaults own the transcript: message rows, tool activity, a
        subagent card in place of each task call, the typing indicator and the
        composer. The application is its session, so admission and saved
        authority stay here; a new conversation remounts it.
      */}
      <Chat
        key={`chat:${snapshot.viewGeneration}`}
        session={application.agent}
        className="subagents-chat"
        label="Message"
        placeholder="Ask about field data or weather…"
        hint="Enter to send. Shift+Enter adds a new line."
        disabled={!snapshot.canSubmit && !snapshot.busy}
        // The footer status already announces progress.
        typingIndicator={{ announce: false }}
        subagents={subagents}
        welcome={{
          title: null,
          suggestions: SUGGESTIONS.map((prompt) => (
            <WelcomeSuggestion
              key={prompt.label}
              label={prompt.label}
              value={prompt.value}
              disabled={!snapshot.canSubmit || snapshot.busy}
              onSelect={(text) => {
                const current = application.getSnapshot();
                if (current.canSubmit && !current.busy)
                  void application.submit(text);
              }}
            />
          )),
        }}
        inputFooter={
          <>
            {snapshot.error && <p role="alert">{snapshot.error}</p>}
            <p role="status">{status}</p>
          </>
        }
      />
    </ExampleLayout>
  );
}
