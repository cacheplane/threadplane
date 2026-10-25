import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { OverflowMenu } from '@threadplane/react/chat';

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
  const [open, setOpen] = useState(false);
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
      <OverflowMenu
        label={`Actions for ${title ? `${title} (${id})` : id}`}
        items={[{ id: 'copy', label, disabled: status === 'pending' }]}
        open={open}
        onOpenChange={setOpen}
        onSelect={(_, event) => void copy(event)}
      />
      {status && (
        <span className="copy-conversation-id__feedback" aria-hidden="true">
          {status === 'pending'
            ? 'Copying…'
            : status === 'success'
            ? 'Copied'
            : 'Failed'}
        </span>
      )}
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
