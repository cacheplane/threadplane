import { getAnonId } from '../shared/anon-id.js';
import { isTelemetryDisabled } from '../shared/env.js';
import { shouldSample } from '../shared/sample.js';
import type { ThreadplaneNodeEvent } from '../shared/events.js';
import { parseTelemetryEvent } from '../shared/ingest.js';
import { isProgrammaticallyDisabled } from './disable.js';

const DEFAULT_INGEST = 'https://threadplane.ai/api/ingest';
const REQUEST_TIMEOUT_MS = 3_000;
// Public identifier accepted by the Threadplane ingest proxy. The proxy re-keys
// server-side with the private PostHog token.
const PUBLIC_INGEST_KEY = 'phc_public_cacheplane_telemetry';

/** Outcome of an explicit Node capture: a successful HTTP response, or a disable, sampling, validation, or send failure reason. */
export type CaptureResult =
  | { sent: true }
  | { sent: false; reason: 'disabled' | 'sampled' | 'failed' | 'invalid' };

function getSampleRate(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.TPLANE_TELEMETRY_SAMPLE_RATE ?? '1');
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(0, Math.min(1, parsed));
}

async function postJson(url: string, body: unknown): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`telemetry ingest failed: ${res.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Validate and explicitly POST a Node lifecycle event with allowed metadata and a memory-only anonymous ID.
 * Environment or programmatic opt-outs prevent sends. Sampling uses `TPLANE_TELEMETRY_SAMPLE_RATE` (default one)
 * with a stable decision per ID and a reciprocal `sample_weight`. Requests use `TPLANE_TELEMETRY_INGEST_URL`
 * or `https://threadplane.ai/api/ingest`, with a three-second abort timeout; rejected or failed captures return a reason.
 */
export async function captureEvent(
  event: ThreadplaneNodeEvent,
  properties: Record<string, unknown> = {}
): Promise<CaptureResult> {
  if (isTelemetryDisabled() || isProgrammaticallyDisabled())
    return { sent: false, reason: 'disabled' };
  const parsed = parseTelemetryEvent(event, properties);
  if (!parsed || parsed.event.startsWith('tplane:browser_')) return { sent: false, reason: 'invalid' };
  const rate = getSampleRate();
  const anonId = getAnonId();
  if (!shouldSample(rate, anonId)) return { sent: false, reason: 'sampled' };
  const payload = parseTelemetryEvent(parsed.event, {
    ...parsed.properties,
    sample_weight: rate > 0 ? 1 / Math.min(1, rate) : 1,
  });
  if (!payload) return { sent: false, reason: 'invalid' };
  try {
    await postJson(process.env.TPLANE_TELEMETRY_INGEST_URL ?? DEFAULT_INGEST, {
      key: PUBLIC_INGEST_KEY,
      distinctId: anonId,
      event: payload.event,
      properties: payload.properties,
    });
    return { sent: true };
  } catch {
    return { sent: false, reason: 'failed' };
  }
}

// @internal — tests only
export function _resetClientForTesting(): void {
  // retained for older tests and downstream test helpers
}
