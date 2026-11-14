// eslint-disable-next-line @nx/enforce-module-boundaries -- The isolated consumer copies this internal example layout.
import { ExampleFooter, ExampleLayout } from '../../../../shared/react-example';
import { useEffect, useRef, useState } from 'react';
import { useAgent } from '@threadplane/react';
import { ChatInput, MessageList } from '@threadplane/react/chat';
import { createStreamingInspection } from './inspection';
import type { InspectionFrame } from './inspection';
import {
  createConnectedApplication,
  type streamingConnection,
} from './connection';

export function StreamingDemo({
  connection,
  onReady,
  onInspection,
}: {
  readonly connection: ReturnType<typeof streamingConnection>;
  readonly onReady: () => void;
  readonly onInspection?: (frame: InspectionFrame) => void;
}) {
  const publisher = useRef(onInspection);
  publisher.current = onInspection;
  const [inspection] = useState(() =>
    createStreamingInspection((frame) => publisher.current?.(frame))
  );
  const [application, setApplication] = useState(() =>
    createConnectedApplication(connection)
  );
  const [resetting, setResetting] = useState(false);
  const [generation, setGeneration] = useState(0);
  const live = useRef(true);
  const snapshot = useAgent(application);
  useEffect(() => inspection.attach(application), [application, inspection]);
  useEffect(() => {
    onReady();
  }, [onReady]);
  useEffect(
    () => () => {
      void application.dispose();
    },
    [application]
  );
  useEffect(
    () => () => {
      live.current = false;
      inspection.dispose();
    },
    [inspection]
  );

  async function reset() {
    if (snapshot.busy || resetting) return;
    setResetting(true);
    inspection.reset();
    await application.dispose();
    if (!live.current) return;
    setApplication(createConnectedApplication(connection));
    setGeneration((value) => value + 1);
    setResetting(false);
  }

  const status = snapshot.busy
    ? snapshot.creation === 'pending'
      ? 'Creating conversation…'
      : 'Receiving response…'
    : snapshot.outcome === 'success'
    ? 'Response complete.'
    : snapshot.outcome === 'aborted'
    ? 'Stopped. Start a new conversation to continue.'
    : !snapshot.canSubmit
    ? 'Start a new conversation to continue.'
    : 'Ready.';

  return (
    <ExampleLayout className="streaming-demo">
      <header>
        <div>
          <h1>LangGraph streaming</h1>
        </div>
        <button
          type="button"
          disabled={snapshot.busy || resetting}
          onClick={() => void reset()}
        >
          New conversation
        </button>
      </header>
      <p>Watch an answer arrive as the agent writes it.</p>
      <MessageList
        running={snapshot.busy}
        typingIndicator={{ announce: false }}
        rows={snapshot.rows}
        label="Conversation"
      />
      <ExampleFooter>
        {snapshot.error && <p role="alert">{snapshot.error}</p>}
        <ChatInput
          key={generation}
          label="Message"
          placeholder="Ask about LangGraph…"
          disabled={resetting || (!snapshot.canSubmit && !snapshot.busy)}
          busy={snapshot.busy}
          onStop={snapshot.busy ? () => void application.stop() : undefined}
          onSubmit={(text) => {
            if (!application.getSnapshot().canSubmit) return false;
            void inspection.submit(application, text);
          }}
        />
        <p role="status">{status}</p>
      </ExampleFooter>
    </ExampleLayout>
  );
}
