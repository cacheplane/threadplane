// libs/langgraph/src/lib/internals/extract-citations.ts
import type { Citation } from '@threadplane/chat';

interface KwargsLike {
  additional_kwargs?: Record<string, unknown> | undefined;
}

/**
 * Normalize {@link @threadplane/chat#Citation | Citation}s out of a message's `additional_kwargs` (reading
 * `citations` or `sources`). Exposed for advanced consumers building custom
 * adapters or bridging non-LangGraph message shapes into the neutral
 * `Citation[]` form.
 *
 * @param msg - Any object with an `additional_kwargs` bag (e.g. a LangChain message).
 * @returns The normalized citations, or `undefined` when none are present.
 * @example
 * ```ts
 * const citations = extractCitations(lcMessage);
 * ```
 */
export function extractCitations(msg: KwargsLike): Citation[] | undefined {
  const raw = msg.additional_kwargs?.['citations'] ?? msg.additional_kwargs?.['sources'];
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw.map((entry, i) => normalizeCitation(entry, i + 1));
}

function normalizeCitation(entry: unknown, fallbackIndex: number): Citation {
  if (typeof entry === 'string') {
    return { id: `c${fallbackIndex}`, index: fallbackIndex, url: entry };
  }
  const e = (entry ?? {}) as Record<string, unknown>;
  const str = (key: string): string | undefined =>
    typeof e[key] === 'string' ? (e[key] as string) : undefined;
  const firstStr = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = str(k);
      if (v !== undefined) return v;
    }
    return undefined;
  };
  const publishedAt = e['publishedAt'];
  const normalizedPublishedAt =
    typeof publishedAt === 'string' || typeof publishedAt === 'number' || publishedAt instanceof Date
      ? publishedAt
      : undefined;
  return {
    id: str('id') ?? str('refId') ?? `c${fallbackIndex}`,
    index: typeof e['index'] === 'number' ? (e['index'] as number) : fallbackIndex,
    title: firstStr('title', 'name'),
    url: firstStr('url', 'href', 'source'),
    snippet: firstStr('snippet', 'content', 'excerpt'),
    sourceType: str('sourceType'),
    iconUrl: str('iconUrl'),
    publishedAt: normalizedPublishedAt,
    extra:
      typeof e['extra'] === 'object' && e['extra'] !== null
        ? (e['extra'] as Record<string, unknown>)
        : undefined,
  };
}
