import { InjectionToken } from '@angular/core';

/** Browser setup, runtime, and stream lifecycle event names supported by the explicit browser service. */
export type ThreadplaneTelemetryEvent =
  | 'tplane:browser_provided'
  | 'tplane:browser_chat_init'
  | 'tplane:runtime_instance_created'
  | 'tplane:runtime_request_created'
  | 'tplane:stream_started'
  | 'tplane:stream_ended'
  | 'tplane:stream_errored';

/** Event name and optional application-supplied properties delivered to an explicit browser event sink. */
export interface ThreadplaneTelemetryEventPayload {
  event: ThreadplaneTelemetryEvent;
  properties?: Record<string, unknown>;
}

/** Application-owned synchronous or asynchronous event delivery callback whose failures the browser service suppresses. */
export type ThreadplaneTelemetrySink = (payload: ThreadplaneTelemetryEventPayload) => void | Promise<void>;

/**
 * Opt-in configuration for explicit browser captures, selecting the first configured delivery: sink, endpoint, or legacy PostHog.
 * Omitted or nonfinite sample rates default to one; finite rates are clamped to zero through one and sampled per capture.
 */
export interface ThreadplaneTelemetryConfig {
  /** Enables capture methods; false makes the explicit browser service inert. */
  enabled: boolean;
  /**
   * Preferred app-owned delivery hook. Use this when the consuming app wants
   * to forward events through its own analytics boundary.
   */
  sink?: ThreadplaneTelemetrySink;
  /**
   * Preferred app-owned ingest URL. The browser service POSTs neutral event
   * payloads here; the endpoint decides where they ultimately go.
   */
  endpoint?: string;
  /** @deprecated Prefer sink or endpoint so public app code is vendor-neutral. */
  posthogKey?: string;
  /** @deprecated Prefer sink or endpoint so public app code is vendor-neutral. */
  posthogHost?: string;
  sampleRate?: number;
}

/** Angular injection token for the explicit browser service's optional capture configuration. */
export const THREADPLANE_TELEMETRY_CONFIG = new InjectionToken<ThreadplaneTelemetryConfig | null>(
  'THREADPLANE_TELEMETRY_CONFIG',
);
