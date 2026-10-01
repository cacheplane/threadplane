import { useRef, useState } from 'react';
import { MessageActions } from '@threadplane/react/chat';

type Attempt = {
  readonly text: string;
  readonly generation: string;
  readonly status: 'pending' | 'success' | 'failure';
};

/** Application-owned browser command. No conversation commands or lifetime ownership. */
export function CopyAnswer({
  text,
  generation,
}: {
  readonly text: string;
  readonly generation: string;
}) {
  const pending = useRef(false);
  const [attempt, setAttempt] = useState<Attempt>();
  const copy = async () => {
    if (pending.current) return;
    pending.current = true;
    const source = { text, generation };
    setAttempt({ ...source, status: 'pending' });
    try {
      const clipboard = globalThis.navigator?.clipboard;
      if (!clipboard?.writeText) throw new Error('Clipboard unavailable');
      await clipboard.writeText(text);
      setAttempt({ ...source, status: 'success' });
    } catch {
      setAttempt({ ...source, status: 'failure' });
    } finally {
      pending.current = false;
    }
  };
  // Keep the row's pending admission even when a correction temporarily clears text.
  if (!text) return null;
  const isPending = attempt?.status === 'pending';
  const current = attempt?.text === text && attempt.generation === generation;
  const status = isPending
    ? 'Copying answer…'
    : current && attempt.status === 'success'
    ? 'Answer copied.'
    : current && attempt.status === 'failure'
    ? 'Could not copy answer.'
    : '';
  return (
    <div className="copy-answer">
      <MessageActions
        actions={[
          { id: 'copy', label: 'Copy answer', onSelect: () => void copy() },
        ]}
        disabled={isPending}
      />
      <span role="status" className="muted">
        {status}
      </span>
    </div>
  );
}
