export type DevelopmentIntegration = 'langgraph' | 'ag-ui' | 'render';
/** Closed set of development progress milestones deduplicated by integration within an inactivity session. */
export type DevelopmentMilestone =
  | 'transport.connected'
  | 'runtime.first_stream_completed'
  | 'thread.persisted'
  | 'interrupt.handled'
  | 'generative_ui.rendered';
/**
 * Package metadata and an optional dynamic enablement policy for a lazy development runtime handle.
 * Collection requires a matching integration/package pair, a valid version, and the runtime's development/browser checks.
 */
export interface DevelopmentRuntimeOptions {
  integration: DevelopmentIntegration;
  packageName:
    | '@threadplane/langgraph'
    | '@threadplane/ag-ui'
    | '@threadplane/render';
  packageVersion: string;
  /** Opaque package-local correlation, never identity or authorization. */
  installationToken?: string | null;
  /** Evaluated at use and send time; omission allows collection subject to the runtime's other checks. */
  enabled?: () => boolean;
}
/**
 * Lazy development collection handle that records activity and deduplicated milestones when collection is allowed.
 * Activity may initialize a stored browser identity and inactivity session; disposing disables this handle and prunes its pending work.
 */
export interface DevelopmentRuntime {
  touch(): void;
  milestone(kind: DevelopmentMilestone, durationMs?: number): void;
  dispose(): void;
}
export interface RuntimeOwner {
  options: DevelopmentRuntimeOptions;
  allowed(): boolean;
}
export interface RuntimeEvent {
  installationToken?: string;
  eventId: string;
  kind: 'runtime.session_started' | DevelopmentMilestone;
  occurredAt: string;
  collectorVersion: '1';
  subject: {
    id: string;
    namespace: 'development_browser';
    scope: 'persistent' | 'memory';
  };
  sessionId: string;
  properties: Record<string, string>;
}
export const MILESTONES: readonly DevelopmentMilestone[] = [
  'transport.connected',
  'runtime.first_stream_completed',
  'thread.persisted',
  'interrupt.handled',
  'generative_ui.rendered',
];
export const MAX_AGE = 24 * 60 * 60 * 1000;
export const SESSION_IDLE = 30 * 60 * 1000;
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
