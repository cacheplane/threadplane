import { Injectable, inject } from '@angular/core';
import {
  THREADPLANE_TELEMETRY_CONFIG,
  type ThreadplaneTelemetryConfig,
  type ThreadplaneTelemetryEvent,
} from './tokens';

// Inlined from shared/events.ts: ng-packagr enforces rootDir at the entry-file
// level (src/browser/), so the browser entry cannot import from ../shared/.
// Keep this type in sync with shared/events.ts.
/** Alias for every event name accepted by the explicit browser service, including runtime and stream events. */
export type ThreadplaneBrowserEvent = ThreadplaneTelemetryEvent;

/** Runtime lifecycle properties captured from browser-side agent adapters. */
export interface ThreadplaneBrowserRuntimeTelemetry {
  /** Runtime transport, such as `langgraph` or `ag-ui`. */
  transport: string;
  /** Optional product or app surface tag. */
  surface?: string;
  /** Optional model provider name. */
  provider?: string;
  /** Optional model name. */
  model?: string;
}

/** Stream telemetry properties captured from browser-side agent adapters. */
export interface ThreadplaneBrowserStreamTelemetry extends ThreadplaneBrowserRuntimeTelemetry {
  /** Stream duration in milliseconds, when known. */
  durationMs?: number;
}

/** Stream error telemetry. The raw error is reduced to an error class. */
export interface ThreadplaneBrowserStreamErrorTelemetry extends ThreadplaneBrowserStreamTelemetry {
  /** Raw error object or value; capture sends only `errorClass`. */
  error?: unknown;
}

function normalizeSampleRate(sampleRate: number | undefined): number {
  if (sampleRate === undefined) return 1;
  if (!Number.isFinite(sampleRate)) return 1;
  if (sampleRate <= 0) return 0;
  if (sampleRate >= 1) return 1;
  return sampleRate;
}

function errorClass(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') {
    return error.name;
  }
  return 'UnknownError';
}

/**
 * Browser-side telemetry service.
 *
 * The service no-ops unless `provideThreadplaneTelemetry({ enabled: true })`
 * configured it. It enriches sent events with `sample_weight`, then delivers
 * them through `sink`, `endpoint`, or legacy PostHog configuration.
 */
@Injectable({ providedIn: 'root' })
export class ThreadplaneTelemetryService {
  private config: ThreadplaneTelemetryConfig | null = inject(THREADPLANE_TELEMETRY_CONFIG, { optional: true });
  private postHogPromise: Promise<typeof import('posthog-js')['default'] | null> | null = null;
  private distinctId: string | null = null;

  /** Capture an event using the configured delivery and sampling options. */
  async capture(event: ThreadplaneTelemetryEvent, properties?: Record<string, unknown>): Promise<void> {
    if (!this.config?.enabled) return;
    const sampleRate = normalizeSampleRate(this.config.sampleRate);
    if (sampleRate === 0) return;
    if (sampleRate < 1 && Math.random() >= sampleRate) return;

    const enrichedProperties = {
      ...(properties ?? {}),
      sample_weight: properties?.['sample_weight'] ?? 1 / sampleRate,
    };

    try {
      if (this.config.sink) {
        await this.config.sink({ event, properties: enrichedProperties });
        return;
      }
      if (this.config.endpoint) {
        await this.captureEndpoint(event, enrichedProperties);
        return;
      }
      if (!this.config.posthogKey) return;
      const ph = await this.loadPostHog();
      if (!ph) return;
      ph.capture(event, enrichedProperties);
    } catch {
      // silent fail
    }
  }

  /** Capture a runtime construction event. */
  captureRuntimeInstanceCreated(input: ThreadplaneBrowserRuntimeTelemetry): Promise<void> {
    return this.capture('tplane:runtime_instance_created', { ...input });
  }

  /** Capture a runtime request creation event. */
  captureRuntimeRequestCreated(input: ThreadplaneBrowserRuntimeTelemetry & { requestType: string }): Promise<void> {
    return this.capture('tplane:runtime_request_created', { ...input });
  }

  /** Capture a stream-start event. */
  captureStreamStarted(input: ThreadplaneBrowserStreamTelemetry): Promise<void> {
    return this.capture('tplane:stream_started', { ...input });
  }

  /** Capture a stream-end event. */
  captureStreamEnded(input: ThreadplaneBrowserStreamTelemetry): Promise<void> {
    return this.capture('tplane:stream_ended', { ...input });
  }

  /** Capture a stream-error event, sending only the derived error class. */
  captureStreamErrored(input: ThreadplaneBrowserStreamErrorTelemetry): Promise<void> {
    const { error, ...rest } = input;
    return this.capture('tplane:stream_errored', {
      ...rest,
      errorClass: errorClass(error),
    });
  }

  private async captureEndpoint(event: ThreadplaneTelemetryEvent, properties: Record<string, unknown>): Promise<void> {
    if (typeof fetch !== 'function' || !this.config?.endpoint) return;
    await fetch(this.config.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        event,
        distinctId: this.getDistinctId(),
        properties,
      }),
    });
  }

  private getDistinctId(): string {
    if (!this.distinctId) {
      const cryptoApi = globalThis.crypto as Crypto | undefined;
      const value = typeof cryptoApi?.randomUUID === 'function'
        ? cryptoApi.randomUUID()
        : Math.random().toString(36).slice(2, 12);
      this.distinctId = `browser:${value}`;
    }
    return this.distinctId;
  }

  private loadPostHog(): Promise<typeof import('posthog-js')['default'] | null> {
    if (!this.postHogPromise) {
      this.postHogPromise = import('posthog-js').then((mod) => {
        if (!this.config?.posthogKey) return null;
        mod.default.init(this.config.posthogKey, {
          api_host: this.config.posthogHost ?? 'https://us.i.posthog.com',
        });
        return mod.default;
      }).catch(() => null);
    }
    return this.postHogPromise;
  }
}
