import { useId, useRef, useState } from 'react';
import { useAgent } from '@threadplane/react';
import type { AgentSession } from '@threadplane/core';

// Keep this owner stable for the lifetime of this illustrative composer.
export function AgentComposer({ session }: { session: AgentSession }) {
  const snapshot = useAgent(session);
  const id = useId();
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [needsReview, setNeedsReview] = useState(false);
  const sending = useRef(false);
  async function send(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending.current || needsReview || snapshot.status === 'running') return;
    sending.current = true;
    setPending(true);
    try {
      const outcome = await session.submit(text);
      if (outcome === 'success') setDraft('');
      setNeedsReview(outcome !== 'success');
      setNotice(`Run outcome: ${outcome}`);
    } catch {
      setNeedsReview(true);
      setNotice('Check the outcome before submitting again.');
    } finally {
      sending.current = false;
      setPending(false);
    }
  }
  return <form onSubmit={send}>
    <label htmlFor={id}>Investigation request</label>
    <input id={id} value={draft} disabled={pending}
      onChange={(event) => setDraft(event.target.value)} />
    <button disabled={pending || needsReview || snapshot.status === 'running'}>Send</button>
    <p role="status">{notice}</p>
  </form>;
}
