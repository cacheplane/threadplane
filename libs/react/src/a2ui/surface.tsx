'use client';
import { useMemo, useRef, useState } from 'react';
import {
  createA2uiActionMessage,
  evaluateA2uiChecks,
  resolveA2uiValue,
  type A2uiActionMessage,
  type A2uiCheckFailure,
  type A2uiValidationErrorMessage,
  type A2uiSurfaces,
  type A2uiSurfaceSnapshot,
  type A2uiValue,
} from '@threadplane/content/a2ui';
import { RenderSpec, type ReactRenderRegistry } from '../render/index.js';
import { a2uiBasicCatalog } from './catalog/index.js';
import { A2uiDefaultFallback } from './default-fallback.js';
import {
  A2uiActionContext,
  A2uiSurfaceContext,
  type A2uiSurfaceActions,
  type A2uiSurfaceWriter,
} from './surface-context.js';
import { a2uiSurfaceTheme } from './surface-theme.js';
import {
  a2uiElementKey,
  a2uiSurfaceSpec,
  type A2uiElementSource,
} from './surface-spec.js';

const NONE: ReadonlyMap<string, A2uiCheckFailure> = new Map();

/** Failing checks by element: a Button's own disable it, every other one blocks a press. */
function split(surface: A2uiSurfaceSnapshot) {
  const buttons = new Set<string>();
  const inputs = new Map<string, A2uiCheckFailure>();
  const kinds = new Map(surface.components.map((item) => [item.id, item.component]));
  for (const failure of evaluateA2uiChecks(surface)) {
    const key = a2uiElementKey(failure.componentId, failure.basePath ?? '');
    if (kinds.get(failure.componentId) === 'Button') buttons.add(key);
    else inputs.set(key, failure);
  }
  return { buttons, inputs };
}

type Args = { readonly [name: string]: A2uiValue };
type Functions = NonNullable<A2uiSurfaceProps['functions']>;

/** A component's `action.functionCall`, with its arguments resolved now. */
function localCall(
  surface: A2uiSurfaceSnapshot,
  source: A2uiElementSource | undefined
) {
  if (source === undefined) return null;
  const { id, basePath } = source;
  const action = surface.components.find((item) => item.id === id)?.['action'];
  const call = (action as { functionCall?: A2uiValue } | null | undefined)
    ?.functionCall as { call?: A2uiValue; args?: A2uiValue } | null | undefined;
  if (typeof call?.call !== 'string') return null;
  const authored = call.args;
  // No prototype, so an argument named `__proto__` is only a key.
  const args: Record<string, A2uiValue> = Object.create(null);
  if (typeof authored === 'object' && authored !== null && !Array.isArray(authored))
    for (const key of Object.keys(authored))
      args[key] = resolveA2uiValue(surface, (authored as Args)[key], basePath);
  return { name: call.call, args: Object.freeze(args) as Args };
}

const OPENABLE = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/** The address `openUrl` may open: web, mail and phone links only. */
function openable(url: A2uiValue): string | null {
  if (typeof url !== 'string' || url.trim() === '') return null;
  try {
    // The server has no page address; any base gives the same answer there.
    const parsed = new URL(
      url,
      typeof window === 'undefined' ? 'http://localhost' : window.location.href
    );
    return OPENABLE.has(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

/** What a press runs for a function-call action, or null when nothing can. */
function runner(
  call: ReturnType<typeof localCall>,
  functions: Functions | undefined
): (() => void) | null {
  if (call === null) return null;
  const own =
    functions !== undefined && Object.hasOwn(functions, call.name)
      ? functions[call.name]
      : undefined;
  if (typeof own === 'function') return () => own(call.args);
  if (call.name !== 'openUrl') return null;
  const href = openable(call.args['url']);
  return href === null
    ? null
    : () => void window.open(href, '_blank', 'noopener,noreferrer');
}

/** Supplies one published surface snapshot and, optionally, the components that render it. */
export interface A2uiSurfaceProps {
  /** A surface from `createA2uiSurfaces().getSnapshot().surfaces`. Snapshots are immutable; pass the current one. */
  readonly surface: A2uiSurfaceSnapshot;
  /**
   * The store this snapshot came from. With it, input components write each
   * edit into that surface's data model, and the store publishes a new
   * snapshot for you to pass back. Without it the surface is read-only.
   */
  readonly surfaces?: A2uiSurfaces;
  /**
   * Receives the action message when a Button with an event action is
   * pressed. Its context is resolved from this surface's current data model.
   * Sending it to the agent is the application's job. Without it, Buttons are
   * disabled.
   */
  readonly onAction?: (message: A2uiActionMessage) => void;
  /**
   * Called when a press was blocked because an input's validation checks do
   * not pass, with the first failure as a v0.9 `VALIDATION_FAILED` error.
   * `onAction` is not called for that press.
   */
  readonly onValidationError?: (error: A2uiValidationErrorMessage) => void;
  /**
   * Runs a Button's function-call action, by function name, with its
   * arguments resolved from this surface's current data model. Nothing is
   * sent to the agent. A function named here replaces the built-in one.
   * `openUrl` is built in: it opens an http, https, mailto or tel `url` in a
   * new tab. A Button whose function nothing can run is disabled.
   */
  readonly functions?: {
    readonly [name: string]: (args: {
      readonly [name: string]: A2uiValue;
    }) => void;
  };
  /** Components by A2UI name. Defaults to `a2uiBasicCatalog()`; keep it stable. */
  readonly catalog?: ReactRenderRegistry;
  readonly className?: string;
}

/**
 * Renders one A2UI surface from a snapshot. Given the store as `surfaces`, its
 * input components write edits into that store; the application keeps passing
 * the store's current snapshot. Edits stay local. A pressed Button hands its
 * resolved action message to `onAction`, and the application transports it.
 * A press is blocked while any input's `checks` fail; the failing inputs then
 * show their messages until they pass. A Button whose own `checks` fail is
 * disabled. A Button with a function-call action runs it here, through
 * `functions` or the built-in `openUrl`, without consulting `checks` on
 * inputs. Function-call props show their current value. A component the
 * catalog lacks keeps its children. A child template is stamped once per
 * item of its list; inputs, checks and actions inside it work on that item.
 * The surface's `theme` sets the accent colour from a hex `primaryColor` and
 * shows `agentDisplayName` and `iconUrl` as a small line above the content.
 */
export function A2uiSurface({
  surface,
  surfaces,
  onAction,
  onValidationError,
  functions,
  catalog,
  className,
}: A2uiSurfaceProps) {
  const { spec, state, sources } = useMemo(
    () => a2uiSurfaceSpec(surface),
    [surface]
  );
  const { surfaceId } = surface;
  const writer = useMemo<A2uiSurfaceWriter>(
    () => ({
      editable: surfaces !== undefined,
      write: (path, value) => {
        if (surfaces !== undefined && path !== undefined)
          surfaces.setValue(surfaceId, path, value);
      },
    }),
    [surfaces, surfaceId]
  );
  // A press reads the snapshot and handler of the latest render, not of the render that mounted the button.
  const latest = useRef({ surface, sources, onAction, onValidationError, functions });
  latest.current = { surface, sources, onAction, onValidationError, functions };
  // Messages stay hidden until a press was blocked, then follow the data model.
  const [blocked, setBlocked] = useState<string | null>(null);
  const failures = useMemo(() => split(surface), [surface]);
  const shown = blocked === surfaceId ? failures.inputs : NONE;
  const sendable = useMemo(
    () =>
      new Set(
        [...sources]
          .filter(
            ([, { id, basePath }]) =>
              createA2uiActionMessage(surface, id, '', basePath) !== null
          )
          .map(([key]) => key)
      ),
    [surface, sources]
  );
  const runnable = useMemo(
    () =>
      new Set(
        [...sources]
          .filter(([, source]) => runner(localCall(surface, source), functions) !== null)
          .map(([key]) => key)
      ),
    [surface, sources, functions]
  );
  const handled = onAction !== undefined;
  const actions = useMemo<A2uiSurfaceActions>(
    () => ({
      actionable: (id) =>
        ((handled && sendable.has(id)) || runnable.has(id)) &&
        !failures.buttons.has(id),
      act: (id) => {
        const current = latest.current;
        const now = split(current.surface);
        if (now.buttons.has(id)) return;
        const source = current.sources.get(id);
        const local = localCall(current.surface, source);
        if (local !== null) return runner(local, current.functions)?.();
        const [first] = now.inputs.values();
        if (first !== undefined) {
          setBlocked(current.surface.surfaceId);
          current.onValidationError?.({
            version: 'v0.9',
            error: {
              code: 'VALIDATION_FAILED',
              surfaceId: current.surface.surfaceId,
              ...(first.path === undefined ? {} : { path: first.path }),
              message: first.message,
            },
          });
          return;
        }
        setBlocked(null);
        const message =
          source === undefined
            ? null
            : createA2uiActionMessage(
                current.surface,
                source.id,
                undefined,
                source.basePath
              );
        if (message !== null) current.onAction?.(message);
      },
      error: (id) => shown.get(id)?.message ?? '',
    }),
    [handled, sendable, runnable, failures, shown]
  );
  const theme = useMemo(() => a2uiSurfaceTheme(surface), [surface]);
  return (
    <div
      className={['a2ui-surface', className].filter(Boolean).join(' ')}
      data-surface-id={surface.surfaceId}
      style={theme.style}
    >
      {theme.name === '' && theme.iconUrl === undefined ? null : (
        <div className="a2ui-surface-chrome">
          {theme.iconUrl === undefined ? null : (
            <img
              className="a2ui-surface-chrome__icon"
              src={theme.iconUrl}
              alt=""
              referrerPolicy="no-referrer"
            />
          )}
          {theme.name === '' ? null : (
            <span className="a2ui-surface-chrome__name">{theme.name}</span>
          )}
        </div>
      )}
      <A2uiSurfaceContext.Provider value={writer}>
        <A2uiActionContext.Provider value={actions}>
          <RenderSpec
            spec={spec}
            registry={catalog ?? a2uiBasicCatalog()}
            state={state}
            fallback={A2uiDefaultFallback}
          />
        </A2uiActionContext.Provider>
      </A2uiSurfaceContext.Provider>
    </div>
  );
}
