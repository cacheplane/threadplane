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
  const root = useRef<HTMLDivElement>(null);
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
        onRename={
          props.canRename
            ? () =>
                props.onRename(
                  props.menu?.returnFocusTo ??
                    root.current?.querySelector('button') ??
                    null
                )
            : undefined
        }
      />
      {props.editor?.id === props.id && (
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
