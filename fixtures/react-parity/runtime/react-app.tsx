import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useAgent } from '@threadplane/react';
import { createFixtureSession } from './runtime-entry.js';
import { attachOwner, display } from './scenarios';

// Application ownership is outside StrictMode and the component lifetime.
let handlerCalls = 0;
let submissions = 0;
const session = createFixtureSession('/api', 'fixture-thread', () => { handlerCalls += 1; });
const submit = (input: string) => { submissions += 1; return session.submit(input); };

function App() {
  const snapshot = useAgent(session);
  const [loadsFinished, setLoadsFinished] = useState(0);
  const [loadError, setLoadError] = useState('');
  const load = async () => {
    if (!session.load) return;
    setLoadError('');
    try { await session.load(); }
    catch { setLoadError('History unavailable'); }
    finally { setLoadsFinished((count) => count + 1); }
  };
  const view = display(snapshot);
  return <main>
    <button disabled={!session.load} onClick={() => void load()}>Load</button>
    <button onClick={() => void submit('Send')}>Send</button>
    <button onClick={() => void submit('Tool')}>Tool</button>
    <button onClick={() => void submit('Error')}>Error</button>
    <button onClick={() => void submit('Hold')}>Hold</button>
    <button onClick={() => void submit('Pause')}>Pause</button>
    <button onClick={() => void session.stop()}>Stop</button>
    <output aria-label="Status" data-testid="status">{snapshot.status}</output>
    <output aria-label="Text" data-testid="text">{view.text}</output>
    <output aria-label="Transcript" data-testid="transcript">{view.transcript}</output>
    <output aria-label="Application values" data-testid="values">{view.values}</output>
    <output aria-label="Interrupts" data-testid="interrupts">{view.interrupts}</output>
    <output aria-label="Loads finished" data-testid="loads-finished">{loadsFinished}</output>
    <output aria-label="Load error" data-testid="load-error">{loadError}</output>
    <output aria-label="Error" data-testid="error">{view.error}</output>
    <output aria-label="Tool result" data-testid="tool">{view.tool}</output>
    <output aria-label="Delivery" data-testid="delivery">{view.delivery}</output>
    <output aria-label="Handler calls" data-testid="handler-calls">{handlerCalls}</output>
    <output aria-label="Submissions" data-testid="submissions">{submissions}</output>
  </main>;
}

const container = document.getElementById('root');
if (!container) throw new Error('Missing fixture root');
const root = createRoot(container);
root.render(<StrictMode><App /></StrictMode>);
attachOwner(session, () => root.unmount());
