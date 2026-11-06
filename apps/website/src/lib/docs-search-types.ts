/**
 * Wire types shared by the search route and the client dialog.
 *
 * This module imports nothing on purpose. `DocsSearchHit` would naturally sit
 * beside `searchIndexedDocs`, but that file's dependency chain reaches
 * `lib/docs.ts` and therefore `fs`. A type-only import is erased at build
 * time, so it would work — right up until someone drops the `type` keyword
 * and pulls Node built-ins into the client bundle. Keeping the types here
 * removes that trap rather than commenting on it.
 */

export interface DocSection {
  /** Heading text, or null for content above the first heading. */
  heading: string | null;
  /** Heading id for a deep link, or null for the page preamble. */
  anchor: string | null;
  /** Searchable prose: fenced code removed, inline code unwrapped. */
  text: string;
}

export interface DocsSearchHit {
  scope?: 'angular' | 'react' | 'shared';
  href: string;
  title: string;
  heading: string | null;
  libraryTitle: string;
  snippet: string;
  /** [start, end) offsets into `snippet`. The client renders the marks. */
  marks: [number, number][];
}
