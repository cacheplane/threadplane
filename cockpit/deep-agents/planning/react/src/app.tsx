// eslint-disable-next-line @nx/enforce-module-boundaries -- The isolated consumer copies this internal example layout.
import { ExampleLayout } from '../../../../shared/react-example';
import { useEffect, useRef, useState } from 'react';
import { useAgent } from '@threadplane/react';
import { Chat, WelcomeSuggestion } from '@threadplane/react/chat';
import {
  createConnectedApplication,
  type PlanningConnection,
} from './connection';
import { PlanPanel } from './plan-panel';
const SUGGESTIONS = [
  {
    label: 'Dispatch brief: KSFO to KASE',
    value:
      'Plan a dispatch brief for a flight from KSFO to KASE: check field elevation, runway length, and weather at both ends, then tell me if there is anything the crew should know.',
  },
] as const;
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
    <ExampleLayout className="planning-demo">
      <header>
        <div>
          <h1>A plan for the flight ahead.</h1>
        </div>
        <button
          type="button"
          onClick={() => {
            if (currentView()) void application.newConversation();
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
          {/*
            Chat's defaults own the transcript: message rows, tool activity, the
            plan the agent declared, the typing indicator and the composer. The
            application is its session, so admission and saved-plan
            confirmation stay here; a new conversation remounts it.
          */}
          <Chat
            key={`chat:${snapshot.viewGeneration}`}
            session={application.agent}
            className="planning-chat"
            label="Message"
            placeholder="Ask for a dispatch brief…"
            hint="Enter to send. Shift+Enter adds a new line."
            disabled={!snapshot.busy && !snapshot.canSubmit}
            // The footer status already announces progress.
            typingIndicator={{ announce: false }}
            welcome={{
              title: (
                <div className="conversation-empty">
                  <span aria-hidden="true">↗</span>
                  <h2>Start with what you want to do.</h2>
                  <p>A message creates your conversation.</p>
                </div>
              ),
              suggestions: SUGGESTIONS.map((prompt) => (
                <WelcomeSuggestion
                  key={prompt.label}
                  label={prompt.label}
                  value={prompt.value}
                  disabled={snapshot.busy || !snapshot.canSubmit}
                  onSelect={(text) => {
                    const current = application.getSnapshot();
                    if (currentView() && !current.busy && current.canSubmit)
                      void application.submit(text);
                  }}
                />
              )),
            }}
            inputFooter={
              <>
                {snapshot.error && (
                  <p role="alert" className="request-error">
                    {snapshot.error}
                  </p>
                )}
                <p role="status" className="response-status">
                  {status}
                </p>
              </>
            }
          />
        </section>
        <PlanPanel
          observed={snapshot.observedPlan}
          saved={snapshot.savedPlan}
          phase={snapshot.phase}
          notice={snapshot.notice}
        />
      </div>
    </ExampleLayout>
  );
}
