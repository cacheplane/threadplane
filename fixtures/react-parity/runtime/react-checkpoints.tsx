import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useAgent } from '@threadplane/react';
import { createFixtureSession } from './runtime-entry.js';
import {
  checkpointInstructions,
  display,
  type FixtureCheckpoint,
} from './scenarios';
import './review.css';

// Application ownership is independent of the observer and StrictMode lifecycle.
let handlerCalls = 0;
const session = createFixtureSession('/api', 'checkpoint-thread', () => {
  handlerCalls++;
});

export function CheckpointApp() {
  const snapshot = useAgent(session);
  const [selected, setSelected] = useState<FixtureCheckpoint>();
  const [outcome, setOutcome] = useState('');
  const [finished, setFinished] = useState(0);
  const [owner, setOwner] = useState('active');
  const [busy, setBusy] = useState(false);
  const view = display(snapshot);
  const command = async (action: () => Promise<string | void>) => {
    setBusy(true);
    setOutcome('running');
    try {
      setOutcome((await action()) ?? 'loaded');
    } catch {
      setOutcome('rejected');
    } finally {
      setFinished((count) => count + 1);
      setBusy(false);
    }
  };
  const dispose = async () => {
    await session.dispose();
    setOwner('disposed');
  };
  const fields = [
    [
      'selected',
      'Selected checkpoint reference',
      selected?.checkpoint_id ?? 'none',
    ],
    ['owner', 'Application owner', owner],
    ['status', 'Session status', snapshot.status],
    ['outcome', 'Last command outcome', outcome],
    ['finished', 'Completed commands', String(finished)],
    ['text', 'Observed transcript', view.transcript],
    ['values', 'Observed values', view.values],
    ['history', 'Last loaded history page', view.history],
    ['reconnect', 'Reconnect run', snapshot.reconnect?.runId ?? ''],
    ['handlers', 'Tool handler calls', String(handlerCalls)],
  ];
  return (
    <main className="review-shell">
      <header>
        <p className="eyebrow">Installed package review · React</p>
        <h1>Checkpoint review</h1>
      </header>
      <section className="panel">
        <h2>Review sequence</h2>
        <p>{checkpointInstructions}</p>
      </section>
      <section className="panel">
        <h2>Application selection and session execution</h2>
        <p>
          The selected ID is local application state. The active execution
          position is retained privately by the session after a confirmed
          command; observed values below come from saved server state.
        </p>
        <div className="controls">
          <button
            disabled={busy}
            onClick={() => void command(() => session.load!())}
          >
            Load
          </button>
          {['A', 'B', 'P'].map((id) => (
            <button
              key={id}
              disabled={
                busy ||
                !snapshot.history?.some(
                  (entry) => entry.checkpoint.checkpoint_id === id
                )
              }
              onClick={() =>
                setSelected(
                  snapshot.history?.find(
                    (entry) => entry.checkpoint.checkpoint_id === id
                  )?.checkpoint
                )
              }
            >
              Select {id}
            </button>
          ))}
          <button
            disabled={busy || !selected}
            onClick={() =>
              void command(() => session.fork(selected!, 'Fork A'))
            }
          >
            Fork selected
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void command(() => session.submit('Continue branch'))
            }
          >
            Continue branch
          </button>
          <button
            disabled={busy}
            onClick={() => void command(() => session.submit('Drop branch'))}
          >
            Drop branch
          </button>
          <button
            disabled={busy || !snapshot.reconnect}
            onClick={() => void command(() => session.reconnect())}
          >
            Reconnect branch
          </button>
          <button
            disabled={busy || owner === 'disposed'}
            onClick={() => void dispose()}
          >
            Dispose
          </button>
        </div>
        <div className="fields">
          {fields.map(([id, label, value]) => (
            <div key={id}>
              <h3>{label}</h3>
              <output data-testid={`checkpoint-${id}`}>{value}</output>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('Missing fixture root');
createRoot(container).render(
  <StrictMode>
    <CheckpointApp />
  </StrictMode>
);
