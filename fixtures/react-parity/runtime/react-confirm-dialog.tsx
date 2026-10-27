import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ConfirmDialog } from '@threadplane/react/chat';

/** Caller-controlled installed modal proof. Every action stays local. */
export function ConfirmDialogFixture() {
  const invoker = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [refuse, setRefuse] = useState(false);
  const [invokerVisible, setInvokerVisible] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [replacement, setReplacement] = useState(false);
  const [confirmations, setConfirmations] = useState(0);
  const [cancellations, setCancellations] = useState(0);
  const [background, setBackground] = useState(0);
  const [shortcuts, setShortcuts] = useState(0);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setShortcuts((count) => count + 1);
      }
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, []);
  const cancel = () => {
    setCancellations((count) => count + 1);
    if (!refuse) setOpen(false);
  };
  return (
    <section
      aria-label="Installed confirmation dialog"
      dir="rtl"
      style={
        {
          fontFamily: 'monospace',
          fontSize: '18px',
          '--tp-chat-surface': 'rgb(241, 242, 243)',
          '--tp-chat-text': 'rgb(11, 22, 33)',
        } as CSSProperties
      }
      onKeyDownCapture={(event) => {
        if (!event.key.startsWith('F')) return;
        if (event.key === 'F2') setPending((value) => !value);
        else if (event.key === 'F3') setRefuse((value) => !value);
        else if (event.key === 'F4') setInvokerVisible((value) => !value);
        else if (event.key === 'F5') setExpanded((value) => !value);
        else if (event.key === 'F6') setReplacement(true);
        else if (event.key === 'F7') setOpen(false);
        else return;
        event.preventDefault();
      }}
    >
      <h1>Installed confirmation dialog</h1>
      <p>
        F2 pending; F3 refuse cancellation; F4 remove invoker; F5 update
        content; F6 replacement modal; F7 close old modal.
      </p>
      <button
        style={{ position: 'fixed', left: 8, top: 8 }}
        onClick={() => setBackground((count) => count + 1)}
      >
        Background action
      </button>
      {invokerVisible && (
        <button ref={invoker} onClick={() => setOpen(true)}>
          Open confirmation
        </button>
      )}
      <output data-testid="confirm-count">{confirmations}</output>
      <output data-testid="cancel-count">{cancellations}</output>
      <output data-testid="background-count">{background}</output>
      <output data-testid="shortcut-count">{shortcuts}</output>
      <ConfirmDialog
        open={open}
        title={
          expanded
            ? 'Updated literal <title> & history. '.repeat(5)
            : 'Delete <literal> & history?'
        }
        body={
          expanded
            ? 'Long literal <body> & details. '.repeat(25)
            : 'Permanent <body> & details.'
        }
        tone="destructive"
        pending={pending}
        confirmLabel="Remove <literal>"
        returnFocusTo={invoker.current}
        onConfirm={() => {
          setConfirmations((count) => count + 1);
          if (!refuse) setOpen(false);
        }}
        onCancel={cancel}
      />
      <ConfirmDialog
        open={replacement}
        title="Replacement confirmation"
        onConfirm={() => setReplacement(false)}
        onCancel={() => setReplacement(false)}
      />
    </section>
  );
}
