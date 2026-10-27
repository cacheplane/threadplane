import { useEffect, useState } from 'react';
import { useAgent } from '@threadplane/react';
import { ChatInput, MessageList } from '@threadplane/react/chat';
import {
  createConnectedApplication,
  type timeTravelConnection,
} from './connection';

export function TimeTravelDemo({
  connection,
  onReady,
}: {
  readonly connection: ReturnType<typeof timeTravelConnection>;
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
  const status = snapshot.busy
    ? snapshot.activity === 'reading'
      ? 'Reading saved checkpoints…'
      : snapshot.activity === 'creating'
      ? 'Creating conversation…'
      : snapshot.activity === 'replacing'
      ? 'Starting new conversation…'
      : 'Receiving response…'
    : !snapshot.canSubmit
    ? 'Start a new conversation to continue.'
    : snapshot.outcome === 'success'
    ? 'Response complete.'
    : 'Ready.';
  return (
    <main className="time-travel-demo">
      <header>
        <div>
          <p className="eyebrow">React · Experimental</p>
          <h1>LangGraph time travel</h1>
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
        Load saved checkpoints, select a completed source, then fork with your
        message. Send continues the conversation shown above.
      </p>
      <MessageList rows={snapshot.rows} label="Conversation" />
      <section aria-label="Last loaded checkpoint page">
        <header>
          <h2>Last loaded checkpoint page</h2>
          <button
            type="button"
            disabled={!snapshot.canRefresh}
            onClick={() => void application.refreshHistory()}
          >
            Refresh saved checkpoints
          </button>
        </header>
        <p>
          This page changes only when you refresh. Selecting a source leaves the
          conversation unchanged.
        </p>
        {snapshot.historyPage === undefined ? (
          <p>No checkpoint page loaded.</p>
        ) : snapshot.historyPage.length === 0 ? (
          <p>The last loaded page was empty.</p>
        ) : (
          <ol>
            {snapshot.historyPage.map((row, index) => (
              <li key={index}>
                <dl>
                  <div>
                    <dt>Checkpoint</dt>
                    <dd>
                      <code>{row.id ?? 'Unavailable identity'}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Namespace</dt>
                    <dd>
                      <code>
                        {row.namespace === ''
                          ? '(root)'
                          : row.namespace ?? 'Unavailable namespace'}
                      </code>
                    </dd>
                  </div>
                  <div>
                    <dt>Saved at</dt>
                    <dd>{row.createdAt ?? 'Unavailable date'}</dd>
                  </div>
                  <div>
                    <dt>Parent</dt>
                    <dd>
                      <code>
                        {row.parentId ?? 'No parent identity observed'}
                      </code>
                    </dd>
                  </div>
                  <div>
                    <dt>Next nodes</dt>
                    <dd>
                      {row.next
                        ? row.next.length
                          ? row.next.join(', ')
                          : 'None observed'
                        : 'Unavailable'}
                    </dd>
                  </div>
                </dl>
                {row.source ? (
                  <button
                    type="button"
                    aria-label={`Select checkpoint ${index + 1}`}
                    aria-pressed={snapshot.selectedSource === row.source}
                    disabled={snapshot.busy || !snapshot.canSubmit}
                    onClick={() => application.selectCheckpoint(index)}
                  >
                    Select
                  </button>
                ) : (
                  <p>{row.unavailable}</p>
                )}
              </li>
            ))}
          </ol>
        )}
        {snapshot.historyError && <p role="alert">{snapshot.historyError}</p>}
      </section>
      <section aria-label="Selected fork source">
        <h2>Selected fork source</h2>
        {snapshot.selectedSource ? (
          <p>
            <code>{snapshot.selectedSource.checkpoint_id}</code>
          </p>
        ) : (
          <p>No source selected.</p>
        )}
        <p>
          Fork uses the message below and checks the saved source before
          starting. Selecting a source leaves Send in the conversation shown
          above.
        </p>
        <button
          type="button"
          disabled={!snapshot.canFork || !draft.trim()}
          onClick={() => {
            if (!application.getSnapshot().canFork || !draft.trim()) return;
            const pending = application.forkSelected(draft);
            if (application.getSnapshot().busy) setDraft('');
            void pending;
          }}
        >
          Fork selected checkpoint
        </button>
      </section>
      {snapshot.error && <p role="alert">{snapshot.error}</p>}
      <ChatInput
        label="Message"
        placeholder="Write a message to send or fork…"
        value={draft}
        onValueChange={setDraft}
        disabled={!snapshot.canSubmit}
        busy={snapshot.busy}
        onStop={snapshot.busy ? () => void application.stop() : undefined}
        onSubmit={(text) => {
          if (!application.getSnapshot().canSubmit) return false;
          const pending = application.submit(text);
          void pending;
          if (!application.getSnapshot().busy) return false;
        }}
      />
      <p role="status">{status}</p>
    </main>
  );
}
