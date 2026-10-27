import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { OverflowMenu } from '@threadplane/react/chat';
import type { ConversationMenuControl } from './use-conversation-menu';

/** Key the command lifetime by ID, including when a caller replaces its item. */
export function CopyConversationId({
  id,
  title,
  menu,
  onRename,
  onPin,
  pinned,
  pinPending,
  onArchive,
  archived,
  archivePending,
  onMoveUp,
  onMoveDown,
  reorderPending,
  onDelete,
  deleteDisabled,
  deleteReason,
  mutationBlocked,
}: {
  readonly id: string;
  readonly title?: string;
  readonly menu?: ConversationMenuControl;
  readonly onRename?: () => void;
  readonly onPin?: () => void;
  readonly pinned?: boolean;
  readonly pinPending?: boolean;
  readonly onArchive?: () => void;
  readonly archived?: boolean;
  readonly archivePending?: boolean;
  readonly onMoveUp?: () => void;
  readonly onMoveDown?: () => void;
  readonly reorderPending?: boolean;
  readonly onDelete?: () => void;
  readonly deleteDisabled?: boolean;
  readonly deleteReason?: string;
  readonly mutationBlocked?: boolean;
}) {
  return (
    <CopyCommand
      key={id}
      id={id}
      title={title}
      menu={menu}
      onRename={onRename}
      onPin={onPin}
      pinned={pinned}
      pinPending={pinPending}
      onArchive={onArchive}
      archived={archived}
      archivePending={archivePending}
      onMoveUp={onMoveUp}
      onMoveDown={onMoveDown}
      reorderPending={reorderPending}
      onDelete={onDelete}
      deleteDisabled={deleteDisabled}
      deleteReason={deleteReason}
      mutationBlocked={mutationBlocked}
    />
  );
}

function CopyCommand({
  id,
  title,
  menu,
  onRename,
  onPin,
  pinned,
  pinPending,
  onArchive,
  archived,
  archivePending,
  onMoveUp,
  onMoveDown,
  reorderPending,
  onDelete,
  deleteDisabled,
  deleteReason,
  mutationBlocked,
}: {
  readonly id: string;
  readonly title?: string;
  readonly menu?: ConversationMenuControl;
  readonly onRename?: () => void;
  readonly onPin?: () => void;
  readonly pinned?: boolean;
  readonly pinPending?: boolean;
  readonly onArchive?: () => void;
  readonly archived?: boolean;
  readonly archivePending?: boolean;
  readonly onMoveUp?: () => void;
  readonly onMoveDown?: () => void;
  readonly reorderPending?: boolean;
  readonly onDelete?: () => void;
  readonly deleteDisabled?: boolean;
  readonly deleteReason?: string;
  readonly mutationBlocked?: boolean;
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
        items={[
          { id: 'copy', label, disabled: status === 'pending' },
          ...(onRename
            ? [
                {
                  id: 'rename',
                  disabled: mutationBlocked,
                  label: `Rename conversation for ${
                    title ? `${title} (${id})` : id
                  }`,
                },
              ]
            : []),
          ...(onPin
            ? [
                {
                  id: 'pin',
                  label: `${
                    pinned === true ? 'Unpin' : 'Pin'
                  } conversation for ${title ? `${title} (${id})` : id}`,
                  disabled: pinPending || mutationBlocked,
                },
              ]
            : []),
          ...(onMoveUp
            ? [
                {
                  id: 'move-up',
                  label: `Move up conversation for ${
                    title ? `${title} (${id})` : id
                  }`,
                  disabled: reorderPending,
                },
              ]
            : []),
          ...(onMoveDown
            ? [
                {
                  id: 'move-down',
                  label: `Move down conversation for ${
                    title ? `${title} (${id})` : id
                  }`,
                  disabled: reorderPending,
                },
              ]
            : []),
          ...(!archived && onDelete
            ? [
                {
                  id: 'delete',
                  label: `Delete conversation for ${
                    title ? `${title} (${id})` : id
                  }${deleteReason ? `. ${deleteReason}` : ''}`,
                  tone: 'destructive' as const,
                  disabled: deleteDisabled,
                },
              ]
            : []),
          ...(onArchive
            ? [
                {
                  id: 'archive',
                  label: `${
                    archived === true ? 'Unarchive' : 'Archive'
                  } conversation for ${title ? `${title} (${id})` : id}`,
                  disabled: archivePending || mutationBlocked,
                },
              ]
            : []),
          ...(archived && onDelete
            ? [
                {
                  id: 'delete',
                  label: `Delete conversation for ${
                    title ? `${title} (${id})` : id
                  }${deleteReason ? `. ${deleteReason}` : ''}`,
                  tone: 'destructive' as const,
                  disabled: deleteDisabled,
                },
              ]
            : []),
        ]}
        open={menu?.open ?? open}
        onOpenChange={menu?.onOpenChange ?? setOpen}
        anchorPoint={menu?.anchorPoint}
        returnFocusTo={menu?.returnFocusTo}
        onSelect={(command, event) => {
          if (command === 'rename') onRename?.();
          else if (command === 'pin') onPin?.();
          else if (command === 'move-up') onMoveUp?.();
          else if (command === 'move-down') onMoveDown?.();
          else if (command === 'delete') onDelete?.();
          else if (command === 'archive') onArchive?.();
          else void copy(event);
        }}
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
