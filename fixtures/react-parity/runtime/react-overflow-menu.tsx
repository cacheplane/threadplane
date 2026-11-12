import { useState } from 'react';
import { ChatWindow, LauncherButton, ChatInput, GenerativeUiSkeleton, MessageRating, OverflowMenu, Select, ThreadList, ThreadRenameForm, Timeline, Trace, type MessageRatingValue, type TimelineItem, type TraceState } from '@threadplane/react/chat';
import '@threadplane/react/chat/styles.css';
import { ConfirmDialogFixture } from './react-confirm-dialog';

/** Installed plain-package command fixture; no backend or session commands. */
export function OverflowMenuFixture() {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [refuse, setRefuse] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [expandedLabel, setExpandedLabel] = useState(false);
  if (new URLSearchParams(window.location.search).has('confirm'))
    return <ConfirmDialogFixture />;
  if (new URLSearchParams(window.location.search).has('select'))
    return <SelectFixture />;
  if (new URLSearchParams(window.location.search).has('shell'))
    return <ShellFixture />;
  if (new URLSearchParams(window.location.search).has('primitives'))
    return <PrimitivesFixture />;
  if (new URLSearchParams(window.location.search).has('rating'))
    return <RatingFixture />;
  if (new URLSearchParams(window.location.search).has('slots'))
    return <ComposerSlotsFixture />;
  if (new URLSearchParams(window.location.search).has('rename'))
    return <main><h1>Installed rename editor</h1><ThreadRenameFormFixture /></main>;
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

/** Installed composer with app-owned leading, trailing and footer content. */
function ComposerSlotsFixture() {
  const [sent, setSent] = useState<string[]>([]);
  const [presses, setPresses] = useState(0);
  const [busy, setBusy] = useState(false);
  const [rtl, setRtl] = useState(false);
  const [files, setFiles] = useState(['itinerary.pdf', 'a-very-long-attachment-name-that-must-not-widen-the-page.png']);
  const [notice, setNotice] = useState(true);
  const [model, setModel] = useState('fast');
  const [modelOpen, setModelOpen] = useState(false);
  return (
    <main dir={rtl ? 'rtl' : 'ltr'}>
      <h1>Installed composer slots</h1>
      <label><input type="checkbox" checked={busy} onChange={(event) => setBusy(event.target.checked)} />Busy</label>
      <label><input type="checkbox" checked={rtl} onChange={(event) => setRtl(event.target.checked)} />Right to left</label>
      <output data-testid="slots-sent">{JSON.stringify(sent)}</output>
      <ChatInput
        onSubmit={(text) => setSent((previous) => [...previous, text])}
        onStop={() => setBusy(false)}
        busy={busy}
        hint="Enter sends"
        leading={<span data-testid="slot-leading">Trip</span>}
        banner={notice && <p role="status" data-testid="slot-banner">Replies are paused <button type="button" onClick={() => setNotice(false)}>Dismiss</button></p>}
        attachments={files.length > 0 && (
          <ul aria-label="Attached files" data-testid="slot-attachments" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: 0, padding: 0, listStyle: 'none' }}>
            {files.map((file) => (
              <li key={file} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{file} <button type="button" onClick={() => setFiles((all) => all.filter((name) => name !== file))}>Remove {file}</button></li>
            ))}
          </ul>
        )}
        trailing={<button type="button" onClick={() => setPresses(presses + 1)}>Tools {presses}</button>}
        footer={<p role="status" data-testid="slot-footer">{sent.length} sent</p>}
      />
      <h2>No slots</h2>
      <ChatInput onSubmit={() => undefined} label="Plain message" />
      <h2>Model picker</h2>
      <ChatInput
        onSubmit={(text) => setSent((previous) => [...previous, text])}
        label="Model message"
        trailing={<Select label="Model" options={[{ value: 'fast', label: 'Fast' }, { value: 'careful', label: 'Careful' }]} value={model} onValueChange={(value) => setModel(value)} open={modelOpen} onOpenChange={setModelOpen} />}
      />
    </main>
  );
}

/** Installed controlled select; the owner may refuse a requested change. */
function RatingFixture() {
  const [values, setValues] = useState<Record<string, MessageRatingValue | null>>({ first: null, second: 'down' });
  const [requests, setRequests] = useState<Array<[MessageRatingValue | null, string]>>([]);
  const [refuse, setRefuse] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [rtl, setRtl] = useState(false);
  const change = (value: MessageRatingValue | null, messageId: string) => {
    setRequests((previous) => [...previous, [value, messageId]]);
    if (!refuse) setValues((previous) => ({ ...previous, [messageId]: value }));
  };
  return (
    <main dir={rtl ? 'rtl' : 'ltr'}>
      <h1>Installed message rating</h1>
      <label><input type="checkbox" checked={refuse} onChange={(event) => setRefuse(event.target.checked)} />Refuse rating changes</label>
      <label><input type="checkbox" checked={disabled} onChange={(event) => setDisabled(event.target.checked)} />Disable ratings</label>
      <label><input type="checkbox" checked={rtl} onChange={(event) => setRtl(event.target.checked)} />Right to left</label>
      <output data-testid="rating-values">{JSON.stringify(values)}</output>
      <output data-testid="rating-requests">{JSON.stringify(requests)}</output>
      <button>Before ratings</button>
      <MessageRating messageId="first" value={values['first']} onValueChange={change} disabled={disabled} />
      <MessageRating messageId="second" value={values['second']} onValueChange={change} disabled={disabled} label="Rate <second>" upLabel="Helpful <b>&" downLabel="Not helpful" className="owned-rating" />
      <button>After ratings</button>
    </main>
  );
}

function SelectFixture() {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [refuse, setRefuse] = useState(false);
  const [requests, setRequests] = useState<string[]>([]);
  return (
    <main>
      <h1>Installed select</h1>
      <label>
        <input
          type="checkbox"
          checked={refuse}
          onChange={(event) => setRefuse(event.currentTarget.checked)}
        />
        Refuse changes
      </label>
      <output data-testid="select-value">{JSON.stringify(value)}</output>
      <output data-testid="select-requests">{JSON.stringify(requests)}</output>
      <div
        dir="rtl"
        style={
          {
            position: 'fixed',
            left: 10,
            bottom: 10,
            overflow: 'hidden',
            fontFamily: 'monospace',
            fontSize: 18,
            lineHeight: '24px',
            colorScheme: 'light',
            '--tp-chat-surface': 'rgb(241, 242, 243)',
            '--tp-chat-text': 'rgb(11, 22, 33)',
          } as React.CSSProperties
        }
      >
        <button>Before select</button>
        <Select
          label="Fixture tone"
          placeholder="Pick a tone"
          options={[
            { value: 'plain<&', label: 'Plain literal <&>', description: 'No <b>markup</b> is interpreted' },
            { value: 'disabled', label: 'Unavailable tone', disabled: true },
            { value: 'formal', label: 'Formal' },
            {
              value: 'long',
              label: 'A long wrapping tone label that stays inside the viewport at every tested width',
            },
          ]}
          value={value}
          onValueChange={(next, event) => {
            if (event.currentTarget.ownerDocument !== document)
              throw Error('Wrong select owner document');
            setRequests((values) => [...values, next]);
            if (!refuse) setValue(next);
          }}
          open={open}
          onOpenChange={setOpen}
        />
        <button>After select</button>
      </div>
    </main>
  );
}

function ThreadRenameFormFixture() {
  const [value, setValue] = useState('Original title');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [submissions, setSubmissions] = useState<string[]>([]);
  const [cancels, setCancels] = useState(0);
  return (
    <section aria-label="Installed rename editor">
      <ThreadRenameForm
        label="Rename fixture title"
        value={value}
        onValueChange={setValue}
        onSubmit={() => setSubmissions((values) => [...values, value.trim()])}
        onCancel={() => setCancels((count) => count + 1)}
        pending={pending}
        error={error ? 'Rename fixture failure' : undefined}
      />
      <label><input type="checkbox" checked={pending} onChange={(event) => setPending(event.currentTarget.checked)} />Rename fixture pending</label>
      <label><input type="checkbox" checked={error} onChange={(event) => setError(event.currentTarget.checked)} />Rename fixture error</label>
      <output data-testid="rename-submissions">{JSON.stringify(submissions)}</output>
      <output data-testid="rename-cancels">{cancels}</output>
    </section>
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

/** Installed LauncherButton and ChatWindow; no backend or session commands. */
function ShellFixture() {
  const [open, setOpen] = useState(false);
  const [presses, setPresses] = useState(0);
  const [header, setHeader] = useState(true);
  return (
    <main>
      <h1>Installed shell</h1>
      <button type="button" onClick={() => setHeader((value) => !value)}>Toggle window header</button>
      <LauncherButton
        expanded={open}
        controls="shell-window"
        onClick={() => {
          setOpen((value) => !value);
          setPresses((value) => value + 1);
        }}
      />
      <output data-testid="launcher-presses">{presses}</output>
      <div id="shell-window" data-testid="shell-frame" style={{ blockSize: 400, border: '1px solid gray' }}>
        <ChatWindow
          header={header ? <strong>Trip-with-an-unbroken-window-title-that-must-wrap-inside-the-header-and-never-widen-the-page</strong> : undefined}
          footer={<textarea aria-label="Message" rows={2} style={{ display: 'block', boxSizing: 'border-box', inlineSize: '100%' }} />}
        >
          <div data-testid="shell-list" style={{ flex: 1, minBlockSize: 0, overflow: 'auto' }}>
            <p style={{ margin: 0, blockSize: 900 }}>Messages</p>
          </div>
        </ChatWindow>
      </div>
    </main>
  );
}

const CHECKPOINTS: readonly TimelineItem[] = [
  { id: 'cp-1', label: 'Search flights', description: 'Two results' },
  { id: 'cp-2', label: 'Pick-a-seat-with-an-unbroken-checkpoint-label-that-must-wrap-inside-the-row-and-never-widen-the-page', disabled: true },
  { id: 'cp-3', label: 'Book' },
];
const TRACE_STATES: readonly TraceState[] = ['pending', 'running', 'done', 'error'];

/** Installed Timeline requests, GenerativeUiSkeleton and Trace; no backend or session commands. */
function PrimitivesFixture() {
  const [selected, setSelected] = useState('cp-1');
  const [actions, setActions] = useState(true);
  const [requests, setRequests] = useState<string[]>([]);
  const [state, setState] = useState<TraceState>('pending');
  const request = (kind: string) => (id: string) => setRequests((values) => [...values, `${kind}:${id}`]);
  return (
    <main>
      <h1>Installed primitives</h1>
      <button type="button" onClick={() => setActions((value) => !value)}>Toggle timeline actions</button>
      <Timeline items={CHECKPOINTS} selectedId={selected} onSelect={setSelected} onReplay={actions ? request('replay') : undefined} onFork={actions ? request('fork') : undefined} />
      <output data-testid="timeline-selected">{selected}</output>
      <output data-testid="timeline-requests">{JSON.stringify(requests)}</output>
      <GenerativeUiSkeleton label="Drawing-the-seat-map-with-an-unbroken-label-that-must-wrap-inside-the-card-and-never-widen-the-page" />
      {TRACE_STATES.map((next) => (
        <button key={next} type="button" onClick={() => setState(next)}>{`Trace ${next}`}</button>
      ))}
      <Trace state={state} icon="*" meta="2s" label="Search-flights-with-an-unbroken-step-label-that-must-wrap-inside-the-toggle-and-never-widen-the-page">
        <p style={{ margin: 0, blockSize: 600 }}>Trace detail</p>
      </Trace>
    </main>
  );
}
