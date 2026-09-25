import type { Citation, PlainValue } from '@threadplane/core';
import { ownValue } from './ownership.js';
import { record } from './wire-message.js';

/** Bounded staging copy of the legacy extractor's aliases. Consolidate at the
 * backend cutover: this neutral contract deliberately requires plain extras and
 * primitive timestamps. Undefined means no update; a supported list replaces. */
export function projectCitations(
  message: Record<string, unknown>
): readonly Citation[] | undefined {
  const kwargs = record(message['additional_kwargs']);
  const raw = kwargs?.['citations'] ?? kwargs?.['sources'];
  if (!Array.isArray(raw)) return undefined;
  return ownValue(
    raw.map((entry, position) => {
      const index = position + 1;
      if (typeof entry === 'string')
        return { id: `c${index}`, index, url: entry };
      const source = record(entry);
      const firstString = (...keys: string[]) => {
        for (const key of keys) {
          const value = source?.[key];
          if (typeof value === 'string') return value;
        }
        return undefined;
      };
      const explicitIndex = source?.['index'];
      const publishedAt = source?.['publishedAt'];
      const extra = record(source?.['extra']);
      const result: Record<string, PlainValue> = {
        id: firstString('id', 'refId') ?? `c${index}`,
        index:
          typeof explicitIndex === 'number' && Number.isFinite(explicitIndex)
            ? explicitIndex
            : index,
      };
      const fields = {
        title: firstString('title', 'name'),
        url: firstString('url', 'href', 'source'),
        snippet: firstString('snippet', 'content', 'excerpt'),
        sourceType: firstString('sourceType'),
        iconUrl: firstString('iconUrl'),
        publishedAt:
          typeof publishedAt === 'string' ||
          (typeof publishedAt === 'number' && Number.isFinite(publishedAt))
            ? publishedAt
            : undefined,
        extra: extra as PlainValue,
      };
      for (const [key, value] of Object.entries(fields))
        if (value !== undefined) result[key] = value;
      return result;
    })
  ) as unknown as readonly Citation[];
}
