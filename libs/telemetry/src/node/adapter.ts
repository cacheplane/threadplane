import { captureEvent } from './client.js';

/** Runtime construction metadata for explicit Node capture; the helper removes `apiKey` before capture. */
export interface RuntimeInstanceTelemetry {
  transport: string;                    // 'langgraph' | 'ag-ui' | 'custom'
  provider?: string;                    // 'openai' | 'anthropic' | ...
  model?: string;
  angularVersion?: string;
  apiKey?: string;                      // stripped before sending
}

/** Explicit Node stream metadata requiring provider and model, with an optional transport and duration in milliseconds. */
export interface StreamTelemetry {
  /** Runtime transport when known; legacy calls without it report `unknown`. */
  transport?: string;
  provider: string;
  model: string;
  durationMs?: number;
}

/** Transport and request classification metadata, with optional provider and model, for explicit Node capture. */
export interface RuntimeRequestTelemetry {
  transport: string;
  requestType: string;
  provider?: string;
  model?: string;
}

async function safe(fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); } catch { /* silent fail */ }
}

function streamProperties(input: StreamTelemetry): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) return null;
  if (typeof input.provider !== 'string' || !input.provider.trim() || typeof input.model !== 'string' || !input.model.trim()) return null;
  return { ...input, transport: input.transport === undefined ? 'unknown' : input.transport };
}

/** Capture a runtime construction event through the Node client after removing `apiKey`, suppressing capture failures. */
export async function captureRuntimeInstanceCreated(input: RuntimeInstanceTelemetry): Promise<void> {
  await safe(async () => {
    const { apiKey, ...rest } = input;
    void apiKey;
    await captureEvent('tplane:runtime_instance_created', { ...rest });
  });
}

/** Capture a runtime request creation event through the Node client's validation, opt-out, and sampling checks, suppressing failures. */
export async function captureRuntimeRequestCreated(input: RuntimeRequestTelemetry): Promise<void> {
  await safe(() => captureEvent('tplane:runtime_request_created', { ...input }));
}

/**
 * Capture a stream-start event for a plain object with nonblank provider and model, suppressing failures.
 * Omitted transport becomes `unknown`; the Node client applies validation, opt-outs, and sampling.
 */
export async function captureStreamStarted(input: StreamTelemetry): Promise<void> {
  await safe(async () => {
    const properties = streamProperties(input);
    if (properties) await captureEvent('tplane:stream_started', properties);
  });
}

/**
 * Capture a stream-end event with optional duration for a plain object with nonblank provider and model, suppressing failures.
 * Omitted transport becomes `unknown`; the Node client applies validation, opt-outs, and sampling.
 */
export async function captureStreamEnded(input: StreamTelemetry): Promise<void> {
  await safe(async () => {
    const properties = streamProperties(input);
    if (properties) await captureEvent('tplane:stream_ended', properties);
  });
}

/**
 * Capture a stream-error event using the Error constructor name, or `Unknown`, without forwarding the raw error.
 * Requires plain-object provider/model metadata, defaults omitted transport to `unknown`, and suppresses capture failures.
 */
export async function captureStreamErrored(
  input: StreamTelemetry & { error: Error | unknown },
): Promise<void> {
  await safe(async () => {
    const properties = streamProperties(input);
    if (!properties) return;
    const { error, ...rest } = input;
    const errorClass = error instanceof Error ? error.constructor.name : 'Unknown';
    await captureEvent('tplane:stream_errored', { ...rest, transport: properties['transport'], errorClass });
  });
}
