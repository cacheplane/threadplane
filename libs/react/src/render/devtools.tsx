import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  devtoolsAvailable,
  dispatchDevtoolsReport,
  fits,
  MAX_RENDER_ELEMENTS,
  MAX_RENDER_NAME_LENGTH,
  MAX_RENDER_REGISTRY,
  now,
  optedOut,
  type RenderDevtoolsReport,
  type RenderElementState,
} from '../devtools/protocol.js';
import type { ReactRenderRegistry, RenderSpecData } from './types.js';

declare const process: { readonly env: { readonly NODE_ENV?: string } };

/** Changes within this window after the first one coalesce into one report. */
export const RENDER_REPORT_WINDOW_MS = 50;

/** What a rendered spec resolved to: names and states, never prop values. */
export interface RenderResolution {
  readonly root: string;
  readonly registry: readonly string[];
  readonly elements: readonly {
    readonly key: string;
    readonly type: string;
    readonly state: RenderElementState;
  }[];
}

interface RenderDevtoolsReporter {
  changed(read: () => RenderResolution | null): void;
  dispose(): void;
}

interface RenderDevtoolsTracker {
  register(key: string, state: RenderElementState): () => void;
  states(): ReadonlyMap<string, RenderElementState>;
  onChange: (() => void) | null;
}

const ReporterContext = createContext<RenderDevtoolsReporter | null>(null);
const TrackerContext = createContext<RenderDevtoolsTracker | null>(null);

/** When one key renders more than once (a repeat), the most-rendered state wins. */
const RANK: Record<RenderElementState, number> = {
  hidden: 0,
  unresolved: 1,
  fallback: 2,
  mounted: 3,
};

let pageSeq = 0;

function createTracker(): RenderDevtoolsTracker {
  const live = new Set<{ key: string; state: RenderElementState }>();
  const tracker: RenderDevtoolsTracker = {
    onChange: null,
    register(key, state) {
      const entry = { key, state };
      live.add(entry);
      tracker.onChange?.();
      return () => {
        live.delete(entry);
        tracker.onChange?.();
      };
    },
    states() {
      const states = new Map<string, RenderElementState>();
      for (const { key, state } of live) {
        const previous = states.get(key);
        if (previous === undefined || RANK[state] > RANK[previous])
          states.set(key, state);
      }
      return states;
    },
  };
  return tracker;
}

/**
 * Resolves every element of `spec` from the live views' states, as Angular's
 * `resolveRenderTree` does. Reads the spec's structure only (`root`, the keys,
 * each element's `type` and `children`), never `props`. An element with no
 * registry entry is `unresolved`, even when `RenderSpec`'s `fallback` view
 * stands in for it; one with an entry but no live view never rendered, so it
 * is `hidden`.
 *
 * @internal Exported for tests.
 */
export function resolveRenderTree(
  spec: RenderSpecData | null | undefined,
  registry: ReactRenderRegistry,
  live: ReadonlyMap<string, RenderElementState>
): RenderResolution | null {
  const root = spec?.root;
  const elements = spec?.elements;
  if (typeof root !== 'string' || !elements || typeof elements !== 'object')
    return null;
  const keys = Object.keys(elements);
  const present = new Set(keys);
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (start: string): void => {
    const stack = [start];
    for (let key = stack.pop(); key !== undefined; key = stack.pop()) {
      if (seen.has(key) || !present.has(key)) continue;
      seen.add(key);
      order.push(key);
      const children: unknown = elements[key]?.children;
      if (!Array.isArray(children)) continue;
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child: unknown = children[index];
        if (typeof child === 'string') stack.push(child);
      }
    }
  };
  visit(root);
  for (const key of keys) visit(key);
  return {
    root,
    registry: Object.keys(registry),
    elements: order.map((key) => {
      const rawType: unknown = elements[key]?.type;
      const type = typeof rawType === 'string' ? rawType : '';
      const state: RenderElementState =
        !type || !Object.hasOwn(registry, type) || !registry[type]
          ? 'unresolved'
          : live.get(key) ?? 'hidden';
      return { key, type, state };
    }),
  };
}

/**
 * Bounds a resolution to the contract the extension validates, as Angular's
 * reporter does: a surface id that does not fit means no report; a name, key
 * or type that does not fit drops that name or element; past the caps the
 * extras are dropped in order.
 *
 * @internal Exported for tests.
 */
export function toRenderReport(
  resolution: RenderResolution,
  id: string | null | undefined
): RenderDevtoolsReport | null {
  const surface =
    typeof id === 'string' && id.length > 0 ? id : `spec:${resolution.root}`;
  if (!fits(surface, MAX_RENDER_NAME_LENGTH)) return null;
  const registry: string[] = [];
  const names = new Set<string>();
  for (const name of resolution.registry) {
    if (registry.length >= MAX_RENDER_REGISTRY) break;
    if (!fits(name, MAX_RENDER_NAME_LENGTH) || names.has(name)) continue;
    names.add(name);
    registry.push(name);
  }
  const elements: RenderDevtoolsReport['elements'] = [];
  for (const { key, type, state } of resolution.elements) {
    if (elements.length >= MAX_RENDER_ELEMENTS) break;
    if (
      !fits(key, MAX_RENDER_NAME_LENGTH) ||
      !fits(type, MAX_RENDER_NAME_LENGTH)
    )
      continue;
    elements.push({ key, type, state });
  }
  return {
    v: 1,
    kind: 'render',
    surface,
    seq: 0,
    registry,
    elements,
    tMs: now(),
  };
}

function createReporter(
  surfaceId: () => string | undefined
): RenderDevtoolsReporter | null {
  if (!devtoolsAvailable()) return null;
  let pending: (() => RenderResolution | null) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSignature = '';
  let disposed = false;
  const flush = (): void => {
    timer = undefined;
    const read = pending;
    pending = null;
    if (!read || disposed || optedOut()) return;
    let report: RenderDevtoolsReport | null;
    try {
      const resolution = read();
      report = resolution ? toRenderReport(resolution, surfaceId()) : null;
    } catch {
      // Devtools must never break the surface it describes.
      return;
    }
    if (!report) return;
    const signature = JSON.stringify([
      report.surface,
      report.registry,
      report.elements,
    ]);
    if (signature === lastSignature) return;
    lastSignature = signature;
    pageSeq += 1;
    report.seq = pageSeq;
    dispatchDevtoolsReport(report);
  };
  return {
    changed(read) {
      if (disposed) return;
      pending = read;
      if (timer === undefined)
        timer = setTimeout(flush, RENDER_REPORT_WINDOW_MS);
    },
    dispose() {
      disposed = true;
      pending = null;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

/** Props for {@link RenderDevtools}. */
export interface RenderDevtoolsProps {
  /** Names the surface in the report; defaults to `'spec:' + root key`. At most 128 characters. */
  readonly surface?: string;
  readonly children?: ReactNode;
}

function DevelopmentRenderDevtools({ surface, children }: RenderDevtoolsProps) {
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;
  const [reporter, setReporter] = useState<RenderDevtoolsReporter | null>(
    null
  );
  useEffect(() => {
    const created = createReporter(() => surfaceRef.current);
    setReporter(created);
    return () => {
      created?.dispose();
      setReporter(null);
    };
  }, []);
  return (
    <ReporterContext.Provider value={reporter}>
      {children}
    </ReporterContext.Provider>
  );
}

function ProductionRenderDevtools({ children }: RenderDevtoolsProps) {
  return children;
}

/**
 * Reports how the `RenderSpec` inside it resolved to the Threadplane DevTools
 * extension in development, as Angular's `<a2ui-surface>` and
 * `<chat-generative-ui>` do: a `threadplane:devtools` `CustomEvent` with
 * `kind: 'render'`, the registry's names, and each element's key, type and
 * state (`mounted`, `fallback`, `unresolved` or `hidden`), never prop values.
 * Changes coalesce for 50 ms, and an unchanged resolution is not reported
 * again. Wrap one surface per `RenderDevtools`.
 *
 * Production builds (`process.env.NODE_ENV === 'production'`) render the
 * children alone. Setting `window.__THREADPLANE_DEVTOOLS_DISABLED__ = true`
 * turns reporting off in development.
 */
export const RenderDevtools: (props: RenderDevtoolsProps) => ReactNode =
  process.env.NODE_ENV !== 'production'
    ? DevelopmentRenderDevtools
    : ProductionRenderDevtools;

/**
 * Collects the live views of one `RenderSpec` and tells the reporter after
 * every commit that the resolution may have changed. Rendered by `RenderSpec`
 * in development only.
 *
 * @internal
 */
export function RenderDevtoolsScope({
  spec,
  registry,
  children,
}: {
  readonly spec: RenderSpecData;
  readonly registry: ReactRenderRegistry;
  readonly children: ReactNode;
}) {
  const reporter = useContext(ReporterContext);
  const [tracker] = useState(createTracker);
  const latest = useRef<{
    spec: RenderSpecData;
    registry: ReactRenderRegistry;
    alive: boolean;
  }>({ spec, registry, alive: true });
  latest.current.spec = spec;
  latest.current.registry = registry;
  const [read] = useState(
    () => (): RenderResolution | null =>
      latest.current.alive
        ? resolveRenderTree(
            latest.current.spec,
            latest.current.registry,
            tracker.states()
          )
        : null
  );
  useLayoutEffect(() => {
    latest.current.alive = true;
    tracker.onChange = reporter ? () => reporter.changed(read) : null;
    return () => {
      latest.current.alive = false;
      tracker.onChange = null;
    };
  }, [reporter, tracker, read]);
  useLayoutEffect(() => {
    reporter?.changed(read);
  });
  return (
    <TrackerContext.Provider value={reporter ? tracker : null}>
      {children}
    </TrackerContext.Provider>
  );
}

/**
 * Registers one committed view's state with the enclosing scope. Rendered by
 * `RenderSpec` and the readiness gate in development only.
 *
 * @internal
 */
export function RenderDevtoolsMark({
  elementKey,
  state,
}: {
  readonly elementKey: string;
  readonly state: RenderElementState;
}) {
  const tracker = useContext(TrackerContext);
  useLayoutEffect(
    () => tracker?.register(elementKey, state),
    [tracker, elementKey, state]
  );
  return null;
}
