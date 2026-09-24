import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useAgent } from '@threadplane/react';
import { createFixtureSession } from './runtime-entry.js';
import './review.css';
import {
  attachOwner,
  display,
  reviewInput,
  reviewInstructions,
  reviewResponse,
  reviewRunOptions,
} from './scenarios';

// Application ownership is outside StrictMode and the component lifetime.
let handlerCalls = 0;
let submissions = 0;
const session = createFixtureSession('/api', 'fixture-thread', () => {
  handlerCalls += 1;
});
const submit = (input: string) => {
  submissions += 1;
  return session.submit(reviewInput(input), reviewRunOptions(input));
};

function App() {
  const snapshot = useAgent(session);
  const [loadsFinished, setLoadsFinished] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [resumesFinished, setResumesFinished] = useState(0);
  const [resumeOutcome, setResumeOutcome] = useState('');
  const [reconnectsFinished, setReconnectsFinished] = useState(0);
  const [reconnectOutcome, setReconnectOutcome] = useState('');
  const reconnect = async () => {
    setReconnectOutcome('');
    try {
      setReconnectOutcome(await session.reconnect());
    } catch {
      setReconnectOutcome('Reconnect unavailable');
    } finally {
      setReconnectsFinished((count) => count + 1);
    }
  };
  const resume = async () => {
    setResumeOutcome('');
    try {
      setResumeOutcome(
        await session.resume(
          reviewResponse(session.getSnapshot()),
          reviewRunOptions('Resume')
        )
      );
    } catch {
      setResumeOutcome('Resume unavailable');
    } finally {
      setResumesFinished((count) => count + 1);
    }
  };
  const load = async () => {
    if (!session.load) return;
    setLoadError('');
    try {
      await session.load();
    } catch {
      setLoadError('History unavailable');
    } finally {
      setLoadsFinished((count) => count + 1);
    }
  };
  const view = display(snapshot);
  return (
    <main className="review-shell">
      <header>
        <p className="eyebrow">Installed package review · React</p>
        <h1>Session runtime</h1>
        <p>
          Observe the application-owned session through the native React
          binding.
        </p>
      </header>
      <section className="panel instructions" aria-label="Review instructions">
        <h2>Review sequence</h2>
        <p>{reviewInstructions}</p>
      </section>
      <section className="panel" aria-label="Session controls">
        <h2>Session controls</h2>
        <div className="controls">
          <button disabled={!session.load} onClick={() => void load()}>
            Load
          </button>
          <button onClick={() => void submit('Send')}>Send</button>
          <button onClick={() => void submit('Tool')}>Tool</button>
          <button onClick={() => void submit('Error')}>Error</button>
          <button onClick={() => void submit('Hold')}>Hold</button>
          <button onClick={() => void submit('Pause')}>Pause</button>
          <button
            disabled={
              snapshot.status === 'running' ||
              !snapshot.interrupts.length ||
              !!snapshot.reconnect
            }
            onClick={() => void resume()}
          >
            Resume
          </button>
          <button onClick={() => void submit('Drop')}>Drop</button>
          <button
            disabled={!snapshot.reconnect}
            onClick={() => void reconnect()}
          >
            Reconnect
          </button>
          <button onClick={() => void session.stop()}>Stop</button>
        </div>
      </section>
      <div className="review-grid">
        <section className="panel" aria-label="Request state panel">
          <h2>Request state</h2>
          <div className="state-grid">
            <div className="field">
              <h3>Status</h3>
              <output aria-label="Status" data-testid="status">
                {snapshot.status}
              </output>
            </div>
            <div className="field">
              <h3>Delivery</h3>
              <output aria-label="Delivery" data-testid="delivery">
                {view.delivery}
              </output>
            </div>
            <div className="field">
              <h3>Loads finished</h3>
              <output aria-label="Loads finished" data-testid="loads-finished">
                {loadsFinished}
              </output>
            </div>
            <div className="field">
              <h3>Submissions</h3>
              <output aria-label="Submissions" data-testid="submissions">
                {submissions}
              </output>
            </div>
            <div className="field">
              <h3>Resumes finished</h3>
              <output
                aria-label="Resumes finished"
                data-testid="resumes-finished"
              >
                {resumesFinished}
              </output>
            </div>
            <div className="field">
              <h3>Resume outcome</h3>
              <output aria-label="Resume outcome" data-testid="resume-outcome">
                {resumeOutcome}
              </output>
            </div>
            <div className="field">
              <h3>Reconnect run</h3>
              <output aria-label="Reconnect run" data-testid="reconnect-run">
                {snapshot.reconnect?.runId ?? ''}
              </output>
            </div>
            <div className="field">
              <h3>Reconnects finished</h3>
              <output
                aria-label="Reconnects finished"
                data-testid="reconnects-finished"
              >
                {reconnectsFinished}
              </output>
            </div>
            <div className="field">
              <h3>Reconnect outcome</h3>
              <output
                aria-label="Reconnect outcome"
                data-testid="reconnect-outcome"
              >
                {reconnectOutcome}
              </output>
            </div>
            <div className="field">
              <h3>Human messages</h3>
              <output aria-label="Human messages" data-testid="human-messages">
                {view.humanMessages}
              </output>
            </div>
            <div className="field">
              <h3>Handler calls</h3>
              <output aria-label="Handler calls" data-testid="handler-calls">
                {handlerCalls}
              </output>
            </div>
            <div className="field">
              <h3>Load error</h3>
              <output aria-label="Load error" data-testid="load-error">
                {loadError}
              </output>
            </div>
            <div className="field">
              <h3>Error</h3>
              <output aria-label="Error" data-testid="error">
                {view.error}
              </output>
            </div>
          </div>
        </section>
        <section className="panel" aria-label="Conversation panel">
          <h2>Conversation</h2>
          <div className="fields">
            <div className="field">
              <h3>Text</h3>
              <output aria-label="Text" data-testid="text">
                {view.text}
              </output>
            </div>
            <div className="field">
              <h3>Transcript</h3>
              <output aria-label="Transcript" data-testid="transcript">
                {view.transcript}
              </output>
            </div>
            <div className="field">
              <h3>Citations</h3>
              <output aria-label="Citations" data-testid="citations">
                {view.citations}
              </output>
              <output aria-label="Reasoning" data-testid="reasoning">
                {view.reasoning}
              </output>
            </div>
          </div>
        </section>
        <section className="panel" aria-label="Application values panel">
          <h2>Application values</h2>
          <div className="fields">
            <div className="field">
              <h3>Application values</h3>
              <output aria-label="Application values" data-testid="values">
                {view.values}
              </output>
            </div>
          </div>
        </section>
        <section className="panel" aria-label="Interrupts panel">
          <h2>Interrupts</h2>
          <div className="fields">
            <div className="field">
              <h3>Interrupts</h3>
              <output aria-label="Interrupts" data-testid="interrupts">
                {view.interrupts}
              </output>
            </div>
          </div>
        </section>
        <section className="panel" aria-label="Checkpoint history panel">
          <h2>Last loaded checkpoint history</h2>
          <p>
            A saved page of checkpoint references. Load refreshes this page.
          </p>
          <output aria-label="Checkpoint history" data-testid="history">
            {view.history}
          </output>
        </section>
        <section className="panel" aria-label="Subgraphs panel">
          <h2>Subgraphs</h2>
          <p>
            Child observations stay separate from the root conversation and
            tools.
          </p>
          <output aria-label="Subgraphs" data-testid="subgraphs">
            {view.subgraphs}
          </output>
        </section>
        <section className="panel" aria-label="Tools panel">
          <h2>Tools</h2>
          <div className="fields">
            <div className="field">
              <h3>Tool result</h3>
              <output aria-label="Tool result" data-testid="tool">
                {view.tool}
              </output>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('Missing fixture root');
const root = createRoot(container);
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
attachOwner(session, () => root.unmount());
