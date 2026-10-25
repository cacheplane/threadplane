import { useState } from 'react';
import { OverflowMenu, ThreadList } from '@threadplane/react/chat';
import '@threadplane/react/chat/styles.css';

/** Installed plain-package command fixture; no backend or session commands. */
export function OverflowMenuFixture() {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [refuse, setRefuse] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [expandedLabel, setExpandedLabel] = useState(false);
  return (
    <main>
      <h1>Installed overflow menu</h1>
      <ThreadContextMenuFixture />
      <p>F2 toggles the focused menu's long command label.</p>
      <label>
        <input
          type="checkbox"
          checked={refuse}
          onChange={(event) => setRefuse(event.currentTarget.checked)}
        />
        Refuse closing
      </label>
      <button onClick={() => setHidden((value) => !value)}>
        Toggle anchor availability
      </button>
      <button onClick={() => setOpen(false)}>Reset open cycle</button>
      <output data-testid="menu-selected">{JSON.stringify(selected)}</output>
      <div
        dir="rtl"
        onKeyDown={(event) => {
          if (!event.defaultPrevented && event.key === 'F2') {
            event.preventDefault();
            setExpandedLabel((value) => !value);
          }
        }}
        style={
          {
            position: 'fixed',
            right: 10,
            bottom: 10,
            fontFamily: 'monospace',
            fontSize: 18,
            lineHeight: '24px',
            colorScheme: 'light',
            '--tp-chat-surface': 'rgb(241, 242, 243)',
            '--tp-chat-text': 'rgb(11, 22, 33)',
          } as React.CSSProperties
        }
      >
        <button>Before menu</button>
        <span hidden={hidden}>
          <OverflowMenu
            label="Fixture actions for full ID"
            open={open}
            onOpenChange={(value) => {
              if (value || !refuse) setOpen(value);
            }}
            items={[
              { id: 'literal<&', label: 'First literal <&>' },
              { id: 'disabled', label: 'Disabled command', disabled: true },
              {
                id: 'last',
                label:
                  'Last destructive command with a long wrapping label that stays inside the viewport' +
                  (expandedLabel
                    ? ' Expanded literal <&> wrapping command text.'.repeat(60)
                    : ''),
                tone: 'destructive',
              },
            ]}
            onSelect={(id, event) => {
              if (event.currentTarget.ownerDocument !== document)
                throw Error('Wrong owner document');
              setSelected((ids) => [...ids, id]);
            }}
          />
        </span>
        <button>After menu</button>
      </div>
    </main>
  );
}

type ContextRequest = {
  readonly id: string;
  readonly point: { readonly x: number; readonly y: number } | null;
  readonly invoker: HTMLElement | null;
};

/** Owner composition uses only the two installed public components. */
function ThreadContextMenuFixture() {
  const [request, setRequest] = useState<ContextRequest | null>(null);
  const [selected, setSelected] = useState('context-a');
  const [commands, setCommands] = useState<string[]>([]);
  const [requests, setRequests] = useState(0);
  const [rtl, setRtl] = useState(false);
  return (
    <section
      aria-label="Installed row context owner"
      dir={rtl ? 'rtl' : 'ltr'}
      style={{
        position: 'fixed',
        left: 12,
        top: 200,
        width: 'min(320px, calc(100vw - 24px))',
      }}
      onKeyDown={(event) => {
        if (!event.defaultPrevented && event.key === 'F3') {
          event.preventDefault();
          const win = event.currentTarget.ownerDocument.defaultView!;
          setRequest(
            (current) =>
              current && {
                ...current,
                point: { x: win.innerWidth - 1, y: win.innerHeight - 1 },
              }
          );
        }
      }}
    >
      <label>
        <input
          type="checkbox"
          checked={rtl}
          onChange={(event) => setRtl(event.currentTarget.checked)}
        />
        Context RTL
      </label>
      <output data-testid="context-selected">{selected}</output>
      <output data-testid="context-commands">{JSON.stringify(commands)}</output>
      <output data-testid="context-requests">{requests}</output>
      <ThreadList
        label="Context fixture conversations"
        threads={[
          { id: 'context-a', title: 'Alpha context' },
          { id: 'context-b<&', title: 'Beta context' },
        ]}
        activeThreadId={selected}
        onSelect={setSelected}
        onContextMenu={(id, event) => {
          event.preventDefault();
          setRequests((count) => count + 1);
          setRequest({
            id,
            point:
              'clientX' in event
                ? { x: event.clientX, y: event.clientY }
                : null,
            invoker: event.currentTarget,
          });
        }}
        renderActions={(thread) => {
          const current = request?.id === thread.id ? request : null;
          return (
            <OverflowMenu
              label={`Context actions for ${thread.title} (${thread.id})`}
              open={current !== null}
              anchorPoint={current?.point}
              returnFocusTo={current?.invoker}
              onOpenChange={(open) => {
                if (open)
                  setRequest({ id: thread.id, point: null, invoker: null });
                else
                  setRequest((latest) => (latest === current ? null : latest));
              }}
              items={[
                { id: 'literal<&', label: 'Context first literal <&>' },
                { id: 'disabled', label: 'Context disabled', disabled: true },
                {
                  id: 'last',
                  label: 'Context last command',
                  tone: 'destructive',
                },
              ]}
              onSelect={(id, event) => {
                if (event.currentTarget.ownerDocument !== document)
                  throw Error('Wrong context owner document');
                setCommands((values) => [...values, `${thread.id}:${id}`]);
              }}
            />
          );
        }}
      />
    </section>
  );
}
