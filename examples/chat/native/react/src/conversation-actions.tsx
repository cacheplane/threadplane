import { useEffect, useRef, useState } from 'react';
import { ThreadRenameForm } from '@threadplane/react/chat';
import { CopyConversationId } from './copy-conversation-id';
import type { ConversationMenuControl } from './use-conversation-menu';

export interface RenameEditorRequest {
  readonly id: string;
  readonly token: number;
  readonly returnFocusTo: HTMLElement | null;
}
interface Props {
  readonly archived?: boolean;
  readonly archivePending?: boolean;
  readonly onArchive?: () => void;
  readonly canSetPinned?: boolean;
  readonly pinned?: boolean;
  readonly pinState?: Readonly<{
    status: 'pending' | 'confirmed' | 'failed';
    pinned: boolean;
  }>;
  readonly setPinned?: (id: string, pinned: boolean) => Promise<boolean>;
  readonly id: string;
  readonly title: string;
  readonly menu?: ConversationMenuControl;
  readonly canRename: boolean;
  readonly pending: boolean;
  readonly rename: (id: string, title: string) => Promise<boolean>;
  readonly editor: RenameEditorRequest | null;
  readonly onRename: (target: HTMLElement | null) => void;
  readonly onClose: (request: RenameEditorRequest) => void;
}

export function ConversationActions(props: Props) {
  return <ConversationActionsOwner key={props.id} {...props} />;
}

function ConversationActionsOwner(props: Props) {
  const root = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const request = useRef<object | null>(null);
  const [pinFeedback, setPinFeedback] = useState<Props['pinState']>();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current = null;
    };
  }, []);
  const pin = async () => {
    if (
      !props.setPinned ||
      request.current ||
      props.pinState?.status === 'pending'
    )
      return;
    const current = {};
    const pinned = props.pinned !== true;
    request.current = current;
    setPinFeedback({ status: 'pending', pinned });
    let confirmed = false;
    try {
      confirmed = await props.setPinned(props.id, pinned);
    } catch {
      /* Optional callbacks may throw as well as reject. */
    }
    if (!mounted.current || request.current !== current) return;
    request.current = null;
    setPinFeedback({ status: confirmed ? 'confirmed' : 'failed', pinned });
  };
  // Shared pending state survives replacement views; completion belongs only
  // to the request started in this keyed UI occurrence.
  const feedback =
    props.pinState?.status === 'pending' ? props.pinState : pinFeedback;
  const menu = props.menu;
  const controlledMenu = menu && {
    ...menu,
    onOpenChange(open: boolean) {
      if (open && props.editor) props.onClose(props.editor);
      menu.onOpenChange(open);
    },
  };
  return (
    <div ref={root} className="conversation-actions">
      <CopyConversationId
        id={props.id}
        title={props.title}
        menu={controlledMenu}
        pinned={props.pinned}
        archived={props.archived}
        archivePending={props.archivePending}
        onArchive={props.onArchive}
        pinPending={
          props.pinState?.status === 'pending' ||
          pinFeedback?.status === 'pending'
        }
        onPin={
          !props.archived && props.canSetPinned && props.setPinned
            ? () => {
                void pin();
              }
            : undefined
        }
        onRename={
          !props.archived && props.canRename
            ? () =>
                props.onRename(
                  props.menu?.returnFocusTo ??
                    root.current?.querySelector('button') ??
                    null
                )
            : undefined
        }
      />
      {feedback && (
        <span role="status" className="conversation-pin-status">
          {feedback.status === 'pending'
            ? feedback.pinned
              ? 'Pinning conversation…'
              : 'Unpinning conversation…'
            : feedback.status === 'confirmed'
            ? feedback.pinned
              ? 'Conversation pinned.'
              : 'Conversation unpinned.'
            : feedback.pinned
            ? 'Could not pin conversation. Try again.'
            : 'Could not unpin conversation. Try again.'}
        </span>
      )}
      {!props.archived && props.editor?.id === props.id && (
        <RenameEditor
          key={props.editor.token}
          {...props}
          request={props.editor}
        />
      )}
    </div>
  );
}

function RenameEditor({
  request,
  title,
  id,
  pending,
  rename,
  onClose,
}: Props & { readonly request: RenameEditorRequest }) {
  const [value, setValue] = useState(title);
  const [error, setError] = useState<string>();
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const formRoot = useRef<HTMLDivElement>(null);
  const ownsFocus = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const root = formRoot.current;
    const doc = root?.ownerDocument;
    const observeFocus = (event: Event) => {
      const target = event.target;
      if (root && target instanceof Node && target !== doc?.body)
        ownsFocus.current = root.contains(target);
    };
    const observePointer = (event: Event) => {
      if (root && event.target instanceof Node && !root.contains(event.target))
        ownsFocus.current = false;
    };
    doc?.addEventListener('focusin', observeFocus);
    doc?.addEventListener('pointerdown', observePointer, true);
    return () => {
      mounted.current = false;
      doc?.removeEventListener('focusin', observeFocus);
      doc?.removeEventListener('pointerdown', observePointer, true);
    };
  }, []);
  const close = () => {
    const root = formRoot.current;
    const doc = root?.ownerDocument;
    const active = doc?.activeElement;
    const target = request.returnFocusTo;
    if (
      root &&
      doc &&
      active &&
      (root.contains(active) || (active === doc.body && ownsFocus.current)) &&
      target &&
      target.ownerDocument === doc &&
      target.isConnected &&
      target.getClientRects().length &&
      !target.closest('[hidden],[inert]') &&
      !target.matches(':disabled')
    )
      target.focus();
    onClose(request);
  };
  const save = async () => {
    const next = value.trim();
    if (pending || inFlight.current || !next || next === title.trim()) return;
    ownsFocus.current = !!formRoot.current?.contains(
      formRoot.current.ownerDocument.activeElement
    );
    inFlight.current = true;
    setError(undefined);
    let success = false;
    try {
      success = await rename(id, next);
    } catch {
      /* The app normally contains transport errors. */
    }
    inFlight.current = false;
    if (!mounted.current) return;
    if (success) close();
    else setError('Could not rename conversation. Try again.');
  };
  return (
    <div ref={formRoot} className="conversation-rename">
      <ThreadRenameForm
        value={value}
        onValueChange={setValue}
        onSubmit={() => void save()}
        onCancel={close}
        pending={pending}
        error={error}
      />
    </div>
  );
}
