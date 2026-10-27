import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useAgent } from '@threadplane/react';
import { createFixtureSession } from './runtime-entry.js';
import {
  createThreadOwner,
  threadInstructions,
  type ThreadSelection,
} from './thread-owner';
import { display } from './scenarios';
import './review.css';

// The application, outside React/StrictMode, owns execution and selection.
const owner = createThreadOwner((id) => createFixtureSession('/api', id));

function ThreadView({ selected }: { selected: ThreadSelection }) {
  const snapshot = useAgent(selected.session);
  const [load, setLoad] = useState('unobserved');
  const [outcome, setOutcome] = useState('');
  const view = display(snapshot);
  const loadSelected = async () => {
    setLoad('loading');
    try {
      await selected.session.load?.();
      setLoad('loaded');
    } catch {
      setLoad('error');
    }
  };
  const run = async () => {
    setOutcome('running');
    try {
      setOutcome(
        await selected.session.submit(
          selected.id === 'thread-a' ? 'Hold A' : 'Send B'
        )
      );
    } catch {
      setOutcome('error');
    }
  };
  return (
    <section className="panel" aria-label="Selected conversation">
      <h2>Selected conversation</h2>
      <div className="controls">
        <button onClick={() => void loadSelected()}>Load selected</button>
        <button onClick={() => void run()}>Run selected</button>
      </div>
      <div className="fields">
        <div>
          <h3>Thread</h3>
          <output data-testid="thread-id">{selected.id}</output>
        </div>
        <div>
          <h3>Session generation</h3>
          <output data-testid="thread-generation">{selected.generation}</output>
        </div>
        <div>
          <h3>Status</h3>
          <output data-testid="thread-status">{snapshot.status}</output>
        </div>
        <div>
          <h3>History request</h3>
          <output data-testid="thread-load">{load}</output>
        </div>
        <div>
          <h3>Run outcome</h3>
          <output data-testid="thread-outcome">{outcome}</output>
        </div>
        <div>
          <h3>Transcript</h3>
          <output data-testid="thread-text">{view.transcript}</output>
        </div>
        <div>
          <h3>Values</h3>
          <output data-testid="thread-values">{view.values}</output>
        </div>
        <div>
          <h3>Checkpoint history</h3>
          <output data-testid="thread-history">{view.history}</output>
        </div>
      </div>
    </section>
  );
}

export function ThreadApp() {
  const [selected, setSelected] = useState(owner.selected);
  const [state, setState] = useState('active');
  const dispose = async () => {
    await owner.dispose();
    setState('disposed');
  };
  return (
    <main className="review-shell">
      <header>
        <p className="eyebrow">Installed package review · React</p>
        <h1>Thread lifetime</h1>
      </header>
      <section className="panel">
        <h2>Review sequence</h2>
        <p>{threadInstructions}</p>
      </section>
      <section className="panel" aria-label="Thread owner">
        <h2>Application selection</h2>
        <div className="controls">
          <button onClick={() => setSelected(owner.select('thread-a'))}>
            Select A
          </button>
          <button onClick={() => setSelected(owner.select('thread-b'))}>
            Select B
          </button>
          <button onClick={() => void dispose()}>Dispose selected</button>
        </div>
        <h3>Owner</h3>
        <output data-testid="thread-owner">{state}</output>
      </section>
      <ThreadView key={selected.generation} selected={selected} />
    </main>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('Missing fixture root');
createRoot(container).render(
  <StrictMode>
    <ThreadApp />
  </StrictMode>
);
