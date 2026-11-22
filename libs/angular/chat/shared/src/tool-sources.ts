// libs/angular/chat/shared/src/tool-sources.ts
import type { Citation } from '@threadplane/core';

/**
 * An application-authored source for a confirmed tool outcome. Only absolute HTTP(S) URLs are shown.
 * Inside a message, declared sources are listed once in its Sources panel; a standalone activity shows them as links.
 */
export interface ToolActivitySource {
  readonly title: string;
  readonly url: string;
  /** A short excerpt shown on the source's card in the Sources panel. */
  readonly snippet?: string;
  /** The source's own icon (absolute URL or `data:` URI) for the Sources panel. Never fetched or guessed by the library. */
  readonly iconUrl?: string;
}

/**
 * Citations for tool-declared sources that the message's own citations do not already cover.
 * Matching is by normalised URL; new entries are numbered after the highest existing index.
 */
export function toolSourceCitations(
  existing: readonly { readonly index: number; readonly url?: string }[],
  sources: readonly ToolActivitySource[]
): Citation[] {
  const href = (url: string | undefined): string | undefined => {
    if (!url) return undefined;
    try {
      return new URL(url).href;
    } catch {
      return undefined;
    }
  };
  const seen = new Set(existing.flatMap((citation) => href(citation.url) ?? []));
  let index = existing.reduce((max, citation) => Math.max(max, citation.index), 0);
  return sources.flatMap((source) => {
    const url = href(source.url);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [
      {
        id: 'tool-source:' + url,
        index: ++index,
        title: source.title,
        url: source.url,
        ...(source.snippet?.trim() ? { snippet: source.snippet } : {}),
        ...(source.iconUrl ? { iconUrl: source.iconUrl } : {}),
      },
    ];
  });
}
