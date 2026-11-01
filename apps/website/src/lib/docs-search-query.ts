import type { DocSection, DocsSearchHit } from './docs-search-types';
import { searchTokens } from './docs-search-tokens';

export type { DocsSearchHit };

export interface IndexedDoc {
  /** Generated API pages have import-path-qualified destinations. */
  href?: string;
  library: string;
  libraryTitle: string;
  /** The docs-config category this page lives under, e.g. "guides". Singular, unrelated to `sections` below. */
  section: string;
  slug: string;
  title: string;
  /** Heading-level blocks within the page body, produced by `indexDocSections`. Unrelated to `section` above. */
  sections: DocSection[];
}

const MAX_RESULTS = 8;
const SNIPPET_RADIUS = 80;

/** Title matches beat heading matches, which beat body prose. */
const TITLE_WEIGHT = 3;
const HEADING_WEIGHT = 2;
const TEXT_WEIGHT = 1;

/** `haystack` must already be lower-cased — callers hoist that conversion so it happens once per field per section, not once per token. */
function countWeighted(lowerHaystack: string, token: string, weight: number): number {
  return lowerHaystack.includes(token) ? weight : 0;
}

/** True for whitespace — the only boundary `toSearchableText` leaves behind. */
function isBoundary(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char);
}

/** Walk left from `index` to the nearest preceding word boundary. */
function snapStart(text: string, index: number): number {
  let i = index;
  while (i > 0 && !isBoundary(text[i - 1])) i -= 1;
  return i;
}

/** Walk right from `index` to the nearest following word boundary. */
function snapEnd(text: string, index: number): number {
  let i = index;
  while (i < text.length && !isBoundary(text[i])) i += 1;
  return i;
}

/**
 * Merge or drop overlapping ranges so the client never has to reason about
 * them. Ranges arrive sorted by start; a range that starts before the
 * previous one ended either extends it (partial overlap) or is dropped
 * entirely (fully contained) — the walk-in-order renderer never sees an
 * overlap either way.
 */
function mergeRanges(ranges: [number, number][]): [number, number][] {
  const merged: [number, number][] = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && start < last[1]) {
      if (end > last[1]) last[1] = end;
      continue;
    }
    merged.push([start, end]);
  }
  return merged;
}

/**
 * A window of `text` around the first token match, snapped to word
 * boundaries so the snippet never opens or closes mid-word.
 *
 * Offsets are returned rather than HTML so the client wraps the ranges
 * itself — nothing server-built is ever rendered into the page.
 */
function buildSnippet(text: string, tokens: string[]): { snippet: string; marks: [number, number][] } {
  const lower = text.toLowerCase();
  const firstMatch = tokens
    .map((token) => lower.indexOf(token))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  // No token appears in this section's text at all when the query matched
  // only the page title (or only the heading) — the AND-check in
  // searchIndexedDocs still passed because those fields carried the match.
  // There is nothing to center a window on, so start the snippet at 0
  // rather than leaving `first` undefined.
  const first = firstMatch ?? 0;

  const rawStart = Math.max(0, first - SNIPPET_RADIUS);
  const rawEnd = Math.min(text.length, first + SNIPPET_RADIUS);
  const start = rawStart > 0 ? snapEnd(text, rawStart) : rawStart;
  const end = rawEnd < text.length ? snapStart(text, rawEnd) : rawEnd;
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  const snippet = `${prefix}${text.slice(start, end)}${suffix}`;

  // Marks are re-derived by scanning the rendered snippet rather than reused
  // from the haystack scan above: they describe what is visible to the
  // reader, so a token occurring in `text` outside this window correctly
  // produces no mark.
  const snippetLower = snippet.toLowerCase();
  const rawMarks: [number, number][] = [];
  for (const token of tokens) {
    let at = snippetLower.indexOf(token);
    while (at >= 0) {
      rawMarks.push([at, at + token.length]);
      at = snippetLower.indexOf(token, at + token.length);
    }
  }
  rawMarks.sort((a, b) => a[0] - b[0]);
  return { snippet, marks: mergeRanges(rawMarks) };
}

export function searchIndexedDocs(docs: IndexedDoc[], query: string): DocsSearchHit[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return [];

  const scored: { score: number; length: number; hit: DocsSearchHit }[] = [];

  for (const doc of docs) {
    const lowerTitle = doc.title.toLowerCase();
    for (const section of doc.sections) {
      const lowerHeading = (section.heading ?? '').toLowerCase();
      const lowerText = section.text.toLowerCase();
      // AND semantics, matching the instant client matcher. Each field is
      // lower-cased once above rather than once per token below.
      const haystack = `${lowerTitle} ${lowerHeading} ${lowerText}`;
      if (!tokens.every((token) => haystack.includes(token))) continue;

      const score = tokens.reduce(
        (total, token) =>
          total +
          countWeighted(lowerTitle, token, TITLE_WEIGHT) +
          countWeighted(lowerHeading, token, HEADING_WEIGHT) +
          countWeighted(lowerText, token, TEXT_WEIGHT),
        0
      );

      const { snippet, marks } = buildSnippet(section.text, tokens);
      scored.push({
        score,
        length: section.text.length,
        hit: {
          href: `${doc.href ?? `/docs/${doc.library}/${doc.section}/${doc.slug}`}${section.anchor ? `#${section.anchor}` : ''}`,
          title: doc.title,
          heading: section.heading,
          libraryTitle: doc.libraryTitle,
          snippet,
          marks,
        },
      });
    }
  }

  // Higher score first; ties go to the shorter section, which favours a
  // precise heading over a long prose blob. Array.prototype.sort is stable,
  // so a tie on both keys keeps the order the docs were passed in.
  scored.sort((a, b) => b.score - a.score || a.length - b.length);
  return scored.slice(0, MAX_RESULTS).map((entry) => entry.hit);
}
