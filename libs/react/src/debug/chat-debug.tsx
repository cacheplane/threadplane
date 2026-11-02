'use client';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { projectDebugValue } from './bounded-value.js';
import { StateDiff } from './debug-state-diff.js';
import {
  createDebugPreferences,
  type DebugPreferences,
  type DebugTab,
} from './persistence.js';
import type { ChatDebugProps, DebugSelection, DebugValue } from './types.js';

const sameSelection = (a: DebugSelection, b: DebugSelection) =>
  a.contextKey === b.contextKey &&
  a.pageGeneration === b.pageGeneration &&
  a.rowKey === b.rowKey;

/** A passive data view. Application code owns reads, selection and resource lifetime. */
export function ChatDebug(props: ChatDebugProps) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const preferences = useRef<
    | {
        key: string | undefined;
        owner: ReturnType<typeof createDebugPreferences>;
      }
    | undefined
  >(undefined);
  const [ui, setUi] = useState<DebugPreferences>({
    open: props.defaultOpen ?? false,
    dock: 'right',
    tab: 'state',
  });
  useEffect(() => {
    if (preferences.current?.key === props.storageKey && preferences.current)
      return;
    let storage;
    try {
      storage = props.storageKey ? window.localStorage : undefined;
    } catch {
      /* Browser property access can itself be denied. */
    }
    const owner = createDebugPreferences(
      props.storageKey ?? '',
      storage,
      props.defaultOpen
    );
    preferences.current = { key: props.storageKey, owner };
    setUi(owner.restore());
  }, [props.storageKey, props.defaultOpen]);
  const change = (next: DebugPreferences) => {
    setUi(next);
    preferences.current?.owner.write(next);
  };
  const close = () => {
    const ownsFocus = root.current?.contains(document.activeElement);
    change({ ...ui, open: false });
    if (ownsFocus) launcher.current?.focus();
  };
  useEffect(() => {
    if (!ui.open) return;
    const outside = (event: PointerEvent) => {
      if (root.current && !event.composedPath().includes(root.current)) {
        // Pointer targets retain their native focus behavior; outside closing never steals it.
        const next = { ...ui, open: false };
        setUi(next);
        preferences.current?.owner.write(next);
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [ui]);
  const tabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const tabs: DebugTab[] = ['state', 'timeline'];
    let tab: DebugTab;
    if (event.key === 'Home') tab = 'state';
    else if (event.key === 'End') tab = 'timeline';
    else if (
      ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)
    )
      tab = tabs[1 - tabs.indexOf(ui.tab)];
    else return;
    event.preventDefault();
    change({ ...ui, tab });
    root.current
      ?.querySelector<HTMLButtonElement>(`[data-tab="${tab}"]`)
      ?.focus();
  };
  const page =
    props.checkpointPage?.contextKey === props.contextKey
      ? props.checkpointPage
      : undefined;
  const scope = JSON.stringify([
    props.contextKey,
    page?.pageGeneration ?? null,
  ]);
  return (
    <div
      ref={root}
      className={['tp-debug', props.className].filter(Boolean).join(' ')}
    >
      <button
        ref={launcher}
        type="button"
        aria-expanded={ui.open}
        aria-controls={`${id}-panel`}
        onClick={() => change({ ...ui, open: !ui.open })}
      >
        {ui.open ? 'Hide debug panel' : 'Open debug panel'}
      </button>
      {ui.open && (
        <section
          id={`${id}-panel`}
          role="region"
          aria-labelledby={`${id}-title`}
          data-dock={ui.dock}
          className="tp-debug__panel"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              close();
            }
          }}
        >
          <header>
            <h2 id={`${id}-title`}>Chat debug</h2>
            <button type="button" onClick={close}>
              Close debug panel
            </button>
          </header>
          <div role="group" aria-label="Debug dock">
            {(['left', 'right', 'bottom'] as const).map((dock) => (
              <button
                type="button"
                key={dock}
                aria-pressed={dock === ui.dock}
                onClick={() => change({ ...ui, dock })}
              >
                Dock {dock}
              </button>
            ))}
          </div>
          <div role="tablist" aria-label="Debug views">
            {(['state', 'timeline'] as const).map((tab) => (
              <button
                type="button"
                key={tab}
                id={`${id}-${tab}`}
                data-tab={tab}
                role="tab"
                tabIndex={ui.tab === tab ? 0 : -1}
                aria-selected={ui.tab === tab}
                aria-controls={`${id}-content`}
                onKeyDown={tabKey}
                onClick={() => change({ ...ui, tab })}
              >
                {tab === 'state' ? 'State' : 'Timeline'}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={props.activity?.busy || !props.onRefresh}
            onClick={() => {
              props.onRefresh?.({
                contextKey: props.contextKey,
                pageGeneration: page?.pageGeneration ?? null,
              });
            }}
          >
            Refresh checkpoints
          </button>
          {props.activity?.status && (
            <p role="status">{props.activity.status}</p>
          )}
          <div
            role="tabpanel"
            id={`${id}-content`}
            aria-labelledby={`${id}-${ui.tab}`}
          >
            <DebugContent
              key={scope}
              {...props}
              checkpointPage={page}
              tab={ui.tab}
            />
          </div>
        </section>
      )}
    </div>
  );
}

function DebugContent(props: ChatDebugProps & { readonly tab: DebugTab }) {
  const page = props.checkpointPage;
  const selection = props.selection;
  const row =
    selection &&
    selection.contextKey === props.contextKey &&
    selection.pageGeneration === page?.pageGeneration
      ? page.rows
          .slice(0, 10)
          .find((row) => row.rowKey === selection.rowKey && row.inspectable)
      : undefined;
  const inspection =
    row &&
    props.inspection &&
    props.inspection.status !== 'idle' &&
    selection &&
    sameSelection(selection, props.inspection.selection)
      ? props.inspection
      : undefined;
  if (props.tab === 'timeline')
    return (
      <>
        <h3>Saved checkpoint page</h3>
        {!page ? (
          <p>Checkpoint page has not been loaded.</p>
        ) : page.rows.length === 0 ? (
          <p>No saved checkpoints in this page.</p>
        ) : (
          <ol>
            {page.rows.slice(0, 10).map((row) => (
              <li key={row.rowKey}>
                <span>{row.label}</span>
                {row.createdAt && <span> — {row.createdAt}</span>}
                {row.parentLabel && <p>Parent: {row.parentLabel}</p>}
                {row.next && <p>Next: {row.next.join(', ')}</p>}
                <button
                  type="button"
                  disabled={
                    !row.inspectable || props.activity?.busy || !props.onInspect
                  }
                  onClick={() => {
                    props.onInspect?.({
                      contextKey: props.contextKey,
                      pageGeneration: page.pageGeneration,
                      rowKey: row.rowKey,
                    });
                  }}
                >
                  Inspect {row.label}
                </button>
              </li>
            ))}
          </ol>
        )}
        {page && (page.truncated || page.rows.length > 10) && (
          <p>
            Checkpoint page is truncated; ordering is as supplied by the
            application.
          </p>
        )}
      </>
    );
  const current =
    props.current.contextKey === props.contextKey ? props.current : undefined;
  return (
    <>
      <h3>Current state</h3>
      {current?.status === 'ready' ? (
        <ValueView values={current.values} label="current state" />
      ) : (
        <p>
          {current?.status === 'unavailable'
            ? current.message ?? 'Current state is unavailable.'
            : 'Current state has not been observed.'}
        </p>
      )}
      {row && (
        <section
          key={JSON.stringify(selection)}
          aria-label="Selected checkpoint"
        >
          <h3>Selected checkpoint: {row.label}</h3>
          <p>
            Row: {row.rowKey}; page: {page?.pageGeneration}
          </p>
          {inspection?.status === 'ready' ? (
            <ValueView values={inspection.values} label="checkpoint values" />
          ) : (
            <p role={inspection?.status === 'error' ? 'alert' : undefined}>
              {inspection?.status === 'loading'
                ? 'Reading selected checkpoint…'
                : inspection?.status === 'error'
                ? inspection.message
                : inspection?.status === 'unavailable'
                ? inspection.message ??
                  'Selected checkpoint values are unavailable.'
                : 'Selected checkpoint has not been inspected.'}
            </p>
          )}
          {inspection?.status === 'ready' && current?.status === 'ready' && (
            <details>
              <summary>Compare selected checkpoint with current state</summary>
              <StateDiff
                before={inspection.values}
                after={current.values}
                label="Selected checkpoint to current state"
              />
            </details>
          )}
        </section>
      )}
    </>
  );
}

function ValueView({
  values,
  label,
}: {
  readonly values: DebugValue;
  readonly label: string;
}) {
  // Equal bounded text can represent distinct source values. Keep their UI and
  // pending clipboard lifetimes separate without traversing the raw value.
  // A render-local state adjustment is discarded with abandoned React renders.
  const [lifetime, setLifetime] = useState({ values, generation: 0 });
  if (!Object.is(lifetime.values, values)) {
    setLifetime({ values, generation: lifetime.generation + 1 });
  }
  const projection = projectDebugValue(values);
  return projection.status === 'ready' ? (
    <Projection
      key={`${lifetime.generation}:${projection.text}`}
      text={projection.text}
      truncated={projection.truncated}
      label={label}
    />
  ) : (
    <p>Values are unavailable: invalid plain data.</p>
  );
}
function Projection({
  text,
  truncated,
  label,
}: {
  readonly text: string;
  readonly truncated: boolean;
  readonly label: string;
}) {
  const [feedback, setFeedback] = useState('');
  const [copying, setCopying] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const copy = async () => {
    setCopying(true);
    setFeedback('');
    try {
      await navigator.clipboard.writeText(text);
      if (mounted.current) setFeedback('Copied displayed projection.');
    } catch {
      if (mounted.current) setFeedback('Could not copy displayed projection.');
    } finally {
      if (mounted.current) setCopying(false);
    }
  };
  return (
    <div className="tp-debug__value">
      {label === 'checkpoint values' ? (
        <details>
          <summary>Displayed checkpoint values</summary>
          <pre>{text}</pre>
        </details>
      ) : (
        <pre>{text}</pre>
      )}
      {truncated && (
        <p>
          Display truncated. Copy includes only the displayed projection
          (maximum 32 KiB), not complete raw state.
        </p>
      )}
      <button
        type="button"
        disabled={copying}
        onClick={() => {
          void copy();
        }}
      >
        Copy displayed {label}
      </button>
      <p role="status">{feedback}</p>
    </div>
  );
}
