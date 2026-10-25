import { useEffect, useRef, useState, type MouseEvent } from 'react';

/** Key the command lifetime by ID, including when a caller replaces its item. */
export function CopyConversationId({
  id,
  title,
}: {
  readonly id: string;
  readonly title?: string;
}) {
  return <CopyCommand key={id} id={id} title={title} />;
}

function CopyCommand({
  id,
  title,
}: {
  readonly id: string;
  readonly title?: string;
}) {
  const pending = useRef(false);
  const mounted = useRef(false);
  const [status, setStatus] = useState<'pending' | 'success' | 'failure'>();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const label = `Copy conversation ID for ${title ? `${title} (${id})` : id}`;
  const copy = async (event: MouseEvent<HTMLButtonElement>) => {
    if (pending.current) return;
    pending.current = true;
    setStatus('pending');
    try {
      const clipboard =
        event.currentTarget.ownerDocument.defaultView?.navigator.clipboard;
      if (!clipboard?.writeText) throw Error('Clipboard unavailable');
      await clipboard.writeText(id);
      if (mounted.current) setStatus('success');
    } catch {
      if (mounted.current) setStatus('failure');
    } finally {
      pending.current = false;
    }
  };
  return (
    <div className="copy-conversation-id">
      <button
        type="button"
        aria-label={label}
        title={label}
        disabled={status === 'pending'}
        onClick={(event) => void copy(event)}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          focusable="false"
        >
          <rect x="8" y="8" width="12" height="12" rx="2" />
          <path d="M16 8V4H4v12h4" />
        </svg>
      </button>
      <span role="status" className="copy-conversation-id__status">
        {status === 'pending'
          ? 'Copying conversation ID…'
          : status === 'success'
          ? 'Conversation ID copied.'
          : status === 'failure'
          ? 'Could not copy conversation ID.'
          : ''}
      </span>
    </div>
  );
}
