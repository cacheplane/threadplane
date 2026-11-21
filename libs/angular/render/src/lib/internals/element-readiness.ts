import type { NormalizedEntry } from '../render.types';

function isPromise(v: unknown): v is Promise<unknown> {
  return typeof (v as { then?: unknown } | null)?.then === 'function';
}

/**
 * Decide whether the REAL component may mount, or the fallback skeleton should
 * show. Pure (no Angular, no signals) so it is trivially unit-testable.
 *
 *  - Any undefined-valued prop → pending (a json-render state binding is still
 *    loading).
 *  - A schema-declared contract → pending until the (possibly streaming) props
 *    validate against it. SYNC validation only: render is synchronous, so an
 *    async (Promise) validate result cannot gate a sync mount and is treated as
 *    ready. View schemas should therefore be synchronous (Zod is).
 */
export function isElementReady(
  entry: NormalizedEntry | undefined,
  resolvedProps: Record<string, unknown>,
): boolean {
  for (const v of Object.values(resolvedProps)) {
    if (v === undefined) return false;
  }
  const schema = entry?.schema;
  if (schema) {
    const out = schema['~standard'].validate(resolvedProps);
    if (!isPromise(out) && out.issues !== undefined) return false;
  }
  return true;
}
