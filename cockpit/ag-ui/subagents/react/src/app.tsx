import { useEffect, useState } from 'react';
import { useAgent } from '@threadplane/react';
import { projectTextTranscript } from '@threadplane/ag-ui';
import {
  ChatInput,
  TextTranscript,
  ToolObservation,
} from '@threadplane/react/chat';
import {
  createConnectedApplication,
  type subagentsConnection,
} from './connection';
import { taskArguments, type ChildCard } from './children';

const titles = {
  research: 'Research specialist',
  booking: 'Booking specialist',
  itinerary: 'Itinerary specialist',
};
function SpecialistCard({
  card,
  active,
  stopped,
}: {
  readonly card: ChildCard;
  readonly active: boolean;
  readonly stopped: boolean;
}) {
  const captured = card.messages.map((message) => message.text).join('\n');
  const display = captured || card.answer;
  return (
    <section
      aria-label={titles[card.role]}
      className="specialist-card"
      data-child-id={card.id}
      data-child-call={card.callId}
      data-child-phase={card.phase}
    >
      <h3>{titles[card.role]}</h3>
      <p className="specialist-phase">
        {card.phase === 'complete'
          ? 'Complete'
          : card.phase === 'error'
          ? 'Could not finish'
          : active
          ? 'Working…'
          : stopped
          ? 'Stopped'
          : 'Incomplete'}
      </p>
      {card.phase === 'error' ? (
        <p>The specialist could not finish.</p>
      ) : display ? (
        <p className="specialist-text">{display}</p>
      ) : active ? (
        <p>Waiting for the specialist’s response…</p>
      ) : (
        <p>No completed specialist response was confirmed.</p>
      )}
    </section>
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
  const transcript = snapshot.native?.transcript ?? [];
  const rows = projectTextTranscript(transcript);
  const status = snapshot.busy
    ? snapshot.activity === 'replacing'
      ? 'Starting new conversation…'
      : 'Planning with specialists…'
    : !snapshot.canSubmit
    ? 'Start a new conversation to continue.'
    : snapshot.outcome === 'success'
    ? 'Response complete.'
    : 'Ready.';
  return (
    <main className="streaming-demo">
      <header>
        <div>
          <p className="eyebrow">React · Experimental</p>
          <h1>AG-UI trip specialists</h1>
        </div>
        <button
          type="button"
          disabled={snapshot.busy}
          onClick={() => void application.newConversation()}
        >
          New conversation
        </button>
      </header>
      <p>
        Plan a fictional trip. Research, booking and itinerary specialists share
        their progress with the main agent.
      </p>
      <section aria-label="Runtime connection">
        <h2>Runtime connection</h2>
        <p>{connection.label}</p>
      </section>
      <section aria-label="Conversation" className="specialist-conversation">
        <ol>
          {transcript
            .filter((message) => !message.subagentRunId)
            .map((message) => {
              const row = rows.find((item) => item.id === message.id);
              const cards = snapshot.cards.filter(
                (card) => card.ownerId === message.id
              );
              const calls =
                message.role === 'assistant' ? message.toolCalls ?? [] : [];
              const resultCard =
                message.role === 'tool'
                  ? snapshot.cards.find(
                      (card) => card.callId === message.toolCallId
                    )
                  : undefined;
              return (
                <li key={message.id} data-parent-message={message.id}>
                  {row && (
                    <TextTranscript messages={[row]} label="Message text" />
                  )}
                  {cards.map((card) => (
                    <SpecialistCard
                      key={card.id}
                      card={card}
                      active={
                        snapshot.busy && snapshot.native?.run?.id === card.runId
                      }
                      stopped={snapshot.outcome === 'aborted'}
                    />
                  ))}
                  {calls.map((call) => {
                    const args = taskArguments(call.function.arguments);
                    const card = cards.find((item) => item.callId === call.id);
                    return args && call.function.name === 'task' ? (
                      <details key={call.id} data-parent-call={call.id}>
                        <summary>Specialist task</summary>
                        <ToolObservation
                          name="task"
                          argumentsText={JSON.stringify(args)}
                          resultText={
                            card?.phase === 'complete'
                              ? card.answer ?? undefined
                              : undefined
                          }
                        />
                      </details>
                    ) : null;
                  })}
                  {message.role === 'tool' && (
                    <details>
                      <summary>Specialist result</summary>
                      <p>
                        {resultCard?.phase === 'complete' && resultCard.answer
                          ? resultCard.answer
                          : 'The specialist result is unavailable.'}
                      </p>
                    </details>
                  )}
                </li>
              );
            })}
        </ol>
      </section>
      {snapshot.error && <p role="alert">{snapshot.error}</p>}
      <ChatInput
        label="Message"
        placeholder="Plan a fictional trip…"
        value={draft}
        onValueChange={setDraft}
        disabled={!snapshot.canSubmit}
        busy={snapshot.busy}
        onStop={snapshot.busy ? () => void application.stop() : undefined}
        onSubmit={(text) => {
          if (!application.getSnapshot().canSubmit) return false;
          void application.submit(text);
          return application.getSnapshot().busy;
        }}
      />
      <p role="status">{status}</p>
    </main>
  );
}
