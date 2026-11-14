import { useMemo, useRef, useState } from 'react';
import { Chat, ChatInput, ChatPopup, ChatWindow, GenerativeUiSkeleton, LauncherButton, MessageRating, OverflowMenu, ProjectList, Select, ThreadList, ThreadRenameForm, Timeline, Trace, WelcomeSuggestion, type MessageRatingValue, type ProjectActionAdapter, type ProjectListItem, type ThreadActionAdapter, type ThreadListItem, type TimelineItem, type TraceState } from '@threadplane/react/chat';
import { completeDelivery, streamingDelivery, type AgentSession, type AgentSnapshot, type Message } from '@threadplane/core';
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
  if (new URLSearchParams(window.location.search).has('primitives'))
    return <PrimitivesFixture />;
  if (new URLSearchParams(window.location.search).has('shell'))
    return <ShellFixture />;
  if (new URLSearchParams(window.location.search).has('welcome'))
    return <WelcomeFixture />;
  if (new URLSearchParams(window.location.search).has('runstatus'))
    return <RunStatusFixture />;
  if (new URLSearchParams(window.location.search).has('actions'))
    return <MessageActionsFixture />;
  if (new URLSearchParams(window.location.search).has('math'))
    return <MathFixture />;
  if (new URLSearchParams(window.location.search).has('lists'))
    return <ListActionsFixture />;
  if (new URLSearchParams(window.location.search).has('reasoning'))
    return <ReasoningRunFixture />;
  if (new URLSearchParams(window.location.search).has('popup'))
    return <PopupFixture />;
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

/** Installed ChatPopup toggle shortcut; no backend or session commands. */
function PopupFixture() {
  const [open, setOpen] = useState(false);
  const [requests, setRequests] = useState(0);
  return (
    <main>
      <h1>Installed popup</h1>
      <input aria-label="Page search" />
      <button type="button">Page button</button>
      <output data-testid="popup-requests">{requests}</output>
      <ChatPopup
        open={open}
        title="Support"
        toggleShortcut="k"
        onOpenChange={(next) => {
          setRequests((value) => value + 1);
          setOpen(next);
        }}
      >
        <textarea aria-label="Draft" />
      </ChatPopup>
    </main>
  );
}

/** A local session that echoes each submission; no backend. */
function echoSession(): AgentSession {
  let snapshot = Object.freeze({ status: 'idle', messages: [] as Message[], toolCalls: [] }) as unknown as AgentSnapshot;
  const listeners = new Set<() => void>();
  let next = 0;
  return {
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    async submit(text: string) {
      const turn = (next += 1);
      const delivery = completeDelivery(`welcome-${turn}`, 'success');
      const added = [
        { id: `u${turn}`, role: 'user', content: text, delivery },
        { id: `a${turn}`, role: 'assistant', content: `Echo: ${text}`, delivery },
      ] as unknown as Message[];
      snapshot = Object.freeze({ ...snapshot, messages: [...snapshot.messages, ...added] }) as AgentSnapshot;
      for (const notify of listeners) notify();
      return 'success';
    },
    async stop() {},
    async dispose() {},
  } as unknown as AgentSession;
}
const welcomeSession = echoSession();

const mathSession = echoSession();
/** A stand-in for a math engine: marks what it was given and makes display math very wide. */
const fixtureMath = (latex: string, { display }: { display: boolean }) => {
  if (latex.includes('bad')) throw new Error('invalid');
  const escaped = latex.trim().replace(/[<&]/g, '');
  return display
    ? `<span data-set="display" style="display:inline-block;inline-size:1600px;white-space:nowrap">${escaped}</span>`
    : `<span data-set="inline" style="font-style:italic">${escaped}</span>`;
};

/** A session that plays one two-step reasoning turn, a stage per call to advance. */
function reasoningSession() {
  const done = (id: string) => completeDelivery(id, 'success');
  const user = { id: 'u1', role: 'user', content: 'What is the answer?', delivery: done('u1') };
  const first = { id: 'a1', role: 'assistant', content: '', reasoning: 'Plan the search.', reasoningDurationMs: 1200, delivery: done('a1') };
  const tool = { id: 't1', role: 'tool', content: 'Search result', delivery: done('t1') };
  const stages = [
    [user, { ...first, reasoningDurationMs: undefined, delivery: streamingDelivery('a1') }],
    [user, first, tool, { id: 'a2', role: 'assistant', content: '', reasoning: 'Compare the', delivery: streamingDelivery('a2') }],
    [user, first, tool, { id: 'a2', role: 'assistant', content: 'The answer is 42.', reasoning: 'Compare the sources.', reasoningDurationMs: 3100, delivery: done('a2') }],
  ] as unknown as Message[][];
  let snapshot = Object.freeze({ status: 'idle', messages: [] as Message[], toolCalls: [] }) as unknown as AgentSnapshot;
  const listeners = new Set<() => void>();
  let stage = 0;
  const session = {
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    async submit() {
      return 'success';
    },
    async stop() {},
    async dispose() {},
  } as unknown as AgentSession;
  const advance = () => {
    if (stage >= stages.length) return;
    snapshot = Object.freeze({ ...snapshot, status: stage < stages.length - 1 ? 'running' : 'idle', messages: stages[stage] }) as AgentSnapshot;
    stage += 1;
    for (const notify of listeners) notify();
  };
  return { session, advance };
}
const reasoningTurn = reasoningSession();

/** Installed merged reasoning: one disclosure for a multi-step turn, or one per step when merging is off. */
function ReasoningRunFixture() {
  const [merge, setMerge] = useState(true);
  return (
    <main>
      <h1>Installed reasoning runs</h1>
      <button type="button" onClick={reasoningTurn.advance}>Next stage</button>
      <label>
        <input type="checkbox" checked={merge} onChange={(event) => setMerge(event.target.checked)} /> Merge reasoning
      </label>
      <div data-testid="reasoning-frame" style={{ display: 'flex', blockSize: 520, border: '1px solid gray' }}>
        <Chat session={reasoningTurn.session} label="Message" mergeReasoning={merge} />
      </div>
    </main>
  );
}

/** Installed built-in conversation and project commands; the fixture owns the rows and can refuse a command. */
function ListActionsFixture() {
  const [threads, setThreads] = useState<readonly ThreadListItem[]>([
    { id: 't1', title: 'Roadmap', pinned: true },
    { id: 't2', title: 'Hiring', pinned: true },
    { id: 't3', title: 'Draft plan' },
    { id: 't4', title: 'A-conversation-with-an-unbroken-title-that-must-wrap-inside-its-row-and-never-widen-the-page' },
  ]);
  const [archived, setArchived] = useState<readonly ThreadListItem[]>([{ id: 't9', title: 'Old notes' }]);
  const [projects, setProjects] = useState<readonly ProjectListItem[]>([
    { id: 'p1', name: 'Research' },
    { id: 'p2', name: 'Launch' },
  ]);
  const [log, setLog] = useState<readonly string[]>([]);
  const [refuse, setRefuse] = useState(false);
  const refusing = useRef(refuse);
  refusing.current = refuse;
  const created = useRef(2);
  const run = (entry: string, apply: () => void) =>
    new Promise<void>((resolve, reject) =>
      setTimeout(() => {
        if (refusing.current) {
          setLog((all) => [...all, `refused:${entry}`]);
          reject(new Error('refused'));
          return;
        }
        setLog((all) => [...all, entry]);
        apply();
        resolve();
      }, 250)
    );
  const pinnedFirst = (rows: readonly ThreadListItem[]) => [...rows.filter((row) => row.pinned), ...rows.filter((row) => !row.pinned)];
  const actions = useMemo<ThreadActionAdapter>(
    () => ({
      rename: (id, title) => run(`rename:${id}:${title}`, () => setThreads((rows) => rows.map((row) => (row.id === id ? { ...row, title } : row)))),
      delete: (id) =>
        run(`delete:${id}`, () => {
          setThreads((rows) => rows.filter((row) => row.id !== id));
          setArchived((rows) => rows.filter((row) => row.id !== id));
        }),
      archive: (id) =>
        run(`archive:${id}`, () =>
          setThreads((rows) => {
            const row = rows.find((item) => item.id === id);
            if (row) setArchived((old) => [...old.filter((item) => item.id !== id), { ...row, pinned: false }]);
            return rows.filter((item) => item.id !== id);
          })
        ),
      unarchive: (id) =>
        run(`unarchive:${id}`, () =>
          setArchived((rows) => {
            const row = rows.find((item) => item.id === id);
            if (row) setThreads((old) => [...old.filter((item) => item.id !== id), row]);
            return rows.filter((item) => item.id !== id);
          })
        ),
      pin: (id) => run(`pin:${id}`, () => setThreads((rows) => pinnedFirst(rows.map((row) => (row.id === id ? { ...row, pinned: true } : row))))),
      unpin: (id) => run(`unpin:${id}`, () => setThreads((rows) => pinnedFirst(rows.map((row) => (row.id === id ? { ...row, pinned: false } : row))))),
      moveToProject: (id, projectId) => run(`move:${id}:${projectId}`, () => undefined),
      reorderPinned: (id, beforeId) =>
        run(`reorder:${id}:${beforeId}`, () =>
          setThreads((rows) => {
            const moved = rows.find((row) => row.id === id);
            if (!moved) return rows;
            const rest = rows.filter((row) => row.id !== id);
            const pinned = rest.filter((row) => row.pinned);
            const at = beforeId === null ? -1 : pinned.findIndex((row) => row.id === beforeId);
            if (at < 0) pinned.push(moved);
            else pinned.splice(at, 0, moved);
            return [...pinned, ...rest.filter((row) => !row.pinned)];
          })
        ),
    }),
    []
  );
  const projectActions = useMemo<ProjectActionAdapter>(
    () => ({
      create: (name) =>
        run(`create:${name}`, () => {
          created.current += 1;
          const id = `p${created.current}`;
          setProjects((rows) => [...rows, { id, name }]);
        }),
      rename: (id, name) => run(`rename-project:${id}:${name}`, () => setProjects((rows) => rows.map((row) => (row.id === id ? { ...row, name } : row)))),
      delete: (id) => run(`delete-project:${id}`, () => setProjects((rows) => rows.filter((row) => row.id !== id))),
    }),
    []
  );
  return (
    <main>
      <h1>Installed list actions</h1>
      <label>
        <input type="checkbox" checked={refuse} onChange={(event) => setRefuse(event.target.checked)} /> Refuse commands
      </label>
      <output data-testid="lists-log">{log.join('|')}</output>
      <div data-testid="lists-frame" className="tp-chat" style={{ inlineSize: 'min(20rem, 100%)', border: '1px solid gray', padding: 8 }}>
        <ThreadList label="Active conversations" threads={threads} onSelect={(id) => setLog((all) => [...all, `select:${id}`])} actions={actions} projects={projects} />
        <ThreadList label="Archived conversations" threads={archived} onSelect={() => undefined} actions={actions} mode="archived" />
        <ProjectList label="Projects" projects={projects} onSelect={(id) => setLog((all) => [...all, `select:${id}`])} actions={projectActions} />
      </div>
    </main>
  );
}

/** Installed math renderer option on Chat. */
function MathFixture() {
  const [on, setOn] = useState(true);
  return (
    <main>
      <h1>Installed math</h1>
      <button type="button" onClick={() => setOn((value) => !value)}>Toggle math</button>
      <div data-testid="math-frame" style={{ display: 'flex', blockSize: 520, border: '1px solid gray' }}>
        <Chat session={mathSession} label="Message" math={on ? fixtureMath : undefined} />
      </div>
    </main>
  );
}

const actionsSession = echoSession();

/** Installed built-in Copy and rating under a finished reply. */
function MessageActionsFixture() {
  const [log, setLog] = useState<readonly string[]>([]);
  const options = useMemo(
    () => ({
      onCopy: (content: string, id: string) => setLog((all) => [...all, `copy:${id}:${content}`]),
      onRate: (rating: 'up' | 'down' | null, id: string) => setLog((all) => [...all, `rate:${id}:${rating}`]),
    }),
    []
  );
  return (
    <main>
      <h1>Installed message actions</h1>
      <output data-testid="actions-log">{log.join('|')}</output>
      <div data-testid="actions-frame" style={{ display: 'flex', blockSize: 520, border: '1px solid gray' }}>
        <Chat session={actionsSession} label="Message" messageActions={options} />
      </div>
    </main>
  );
}

/** A session whose runs last until Stop (no reply kept) or the fixture's Finish (a reply). */
function heldSession() {
  let snapshot = Object.freeze({ status: 'idle', messages: [] as Message[], toolCalls: [] }) as unknown as AgentSnapshot;
  const listeners = new Set<() => void>();
  let turn = 0;
  const set = (next: Partial<AgentSnapshot>) => {
    snapshot = Object.freeze({ ...snapshot, ...next }) as AgentSnapshot;
    for (const notify of listeners) notify();
  };
  const session = {
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    async submit(text: string) {
      turn += 1;
      const user = { id: `u${turn}`, role: 'user', content: text, delivery: completeDelivery(`u${turn}`, 'success') } as unknown as Message;
      set({ status: 'running', messages: [...snapshot.messages, user] });
      return 'success';
    },
    async stop() {
      set({ status: 'idle' });
    },
    async dispose() {},
  } as unknown as AgentSession;
  const finish = () => {
    const reply = { id: `a${turn}`, role: 'assistant', content: `Reply ${turn}`, delivery: completeDelivery(`a${turn}`, 'success') } as unknown as Message;
    set({ status: 'idle', messages: [...snapshot.messages, reply] });
  };
  return { session, finish };
}
const held = heldSession();

/** Installed Chat run status and composer running hint. */
function RunStatusFixture() {
  return (
    <main>
      <h1>Installed run status</h1>
      <button type="button" onClick={held.finish}>Finish</button>
      <div data-testid="run-status-frame" style={{ display: 'flex', blockSize: 520, border: '1px solid gray' }}>
        <Chat session={held.session} label="Message" runStatus runningHint />
      </div>
    </main>
  );
}

/** Installed Chat welcome greeting; the session is local and echoes. */
function WelcomeFixture() {
  return (
    <main>
      <h1>Installed welcome</h1>
      <div data-testid="welcome-frame" style={{ display: 'flex', blockSize: 520, border: '1px solid gray' }}>
        <Chat
          session={welcomeSession}
          label="Message"
          welcome={{
            suggestions: (
              <>
                <WelcomeSuggestion label="Plan a weekend in Lyon" value="Plan a weekend in Lyon" onSelect={(value) => void welcomeSession.submit(value)} />
                <WelcomeSuggestion
                  label="A-suggestion-with-an-unbroken-label-that-must-wrap-inside-the-greeting-and-never-widen-the-page"
                  value="Long"
                  onSelect={(value) => void welcomeSession.submit(value)}
                />
              </>
            ),
          }}
        />
      </div>
    </main>
  );
}
