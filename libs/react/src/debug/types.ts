/** Plain, app-owned JSON; no SDK objects or runtime capabilities. */
export type DebugValue =
  | null
  | boolean
  | number
  | string
  | readonly DebugValue[]
  | { readonly [key: string]: DebugValue };

/** Identifies an inspectable checkpoint row within a specific application context and page generation. */
export interface DebugSelection {
  readonly contextKey: string;
  readonly pageGeneration: number;
  readonly rowKey: string;
}

/** Refresh intent scoped to the current context; pageGeneration is null when no matching page is displayed. */
export interface DebugRefreshRequest {
  readonly contextKey: string;
  readonly pageGeneration: number | null;
}

/** Display metadata only. The app privately maps opaque row keys to reads.
 * The app supplies a bounded page (first slice: at most ten rows, as received).
 * Missing/duplicate identities remain visible with inspectable=false.
 */
export interface DebugCheckpointRow {
  readonly rowKey: string;
  readonly label: string;
  readonly createdAt?: string;
  readonly parentLabel?: string;
  readonly next?: readonly string[];
  readonly inspectable: boolean;
}

/** App-supplied checkpoint rows scoped to a context and generation, with a flag indicating omitted rows. */
export interface DebugCheckpointPage {
  readonly contextKey: string;
  readonly pageGeneration: number;
  readonly rows: readonly DebugCheckpointRow[];
  readonly truncated: boolean;
}

/** Unknown/unavailable must never become an observed empty object. */
export type DebugCurrentObservation = { readonly contextKey: string } & (
  | { readonly status: 'unknown' }
  | { readonly status: 'unavailable'; readonly message?: string }
  | { readonly status: 'ready'; readonly values: DebugValue }
);

/** App-owned checkpoint read state; every active result carries the selection that produced it. */
export type DebugInspection =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly selection: DebugSelection }
  | {
      readonly status: 'ready';
      readonly selection: DebugSelection;
      readonly values: DebugValue;
    }
  | {
      readonly status: 'error';
      readonly selection: DebugSelection;
      readonly message: string;
    }
  | {
      readonly status: 'unavailable';
      readonly selection: DebugSelection;
      readonly message?: string;
    };

/** Passive view requests are synchronous notifications, never readers. The app
 * owns SDK calls, cancellation, stale-result checks and snapshot lifetimes.
 */
export interface ChatDebugProps {
  readonly contextKey: string;
  readonly current: DebugCurrentObservation;
  readonly checkpointPage?: DebugCheckpointPage;
  readonly selection?: DebugSelection;
  readonly inspection?: DebugInspection;
  readonly activity?: { readonly busy: boolean; readonly status?: string };
  readonly onInspect?: (selection: DebugSelection) => undefined;
  readonly onRefresh?: (request: DebugRefreshRequest) => undefined;
  readonly defaultOpen?: boolean;
  readonly storageKey?: string;
  readonly className?: string;
}
