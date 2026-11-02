// libs/chat/src/lib/a2ui/envelope-normalizer.ts

const ENVELOPE_KEYS = ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface'] as const;

/**
 * The parent LLM may emit envelope-tool arguments in four shapes (observed in
 * the spike across gpt-5-mini and gpt-5): the canonical `{envelopes: [...]}`,
 * a singular typo `{envelope: [...]}`, positional keys `{0: env, 1: env, ...}`
 * when the model treats the args as the array, or a flat single envelope.
 * This pure function maps all four into a canonical envelope list.
 *
 * Strict-mode tool binding (OpenAI) should eliminate the non-canonical
 * shapes in production, but the normalizer is the safety net.
 */
export function normalizeEnvelopeArgs(
  args: Record<string, unknown> | null | undefined,
): unknown[] | null {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;

  // (a) canonical: { envelopes: [...] }
  if (Array.isArray((args as { envelopes?: unknown }).envelopes)) {
    return (args as { envelopes: unknown[] }).envelopes;
  }
  // (b) singular typo: { envelope: [...] }
  if (Array.isArray((args as { envelope?: unknown }).envelope)) {
    return (args as { envelope: unknown[] }).envelope;
  }
  const keys = Object.keys(args);
  if (keys.length === 0) return null;
  // (c) positional keys: { 0: env, 1: env, ... }
  if (keys.every((k) => /^\d+$/.test(k))) {
    return keys
      .map((k) => Number(k))
      .sort((a, b) => a - b)
      .map((k) => (args as Record<string, unknown>)[String(k)]);
  }
  // (d) flat single envelope: { createSurface: {...} } | { updateComponents: ... } | etc
  if (ENVELOPE_KEYS.some((k) => k in args)) {
    return [args];
  }
  return null;
}
