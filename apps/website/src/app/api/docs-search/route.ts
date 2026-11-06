import type { DocsScope } from '../../../lib/docs-catalog';
import { NextResponse } from 'next/server';
import { getAllDocSlugs, getDocByPath } from '../../../lib/docs';
import { getLibraryConfig } from '../../../lib/docs-config';
import { indexDocSections } from '../../../lib/docs-search-index';
import {
  searchIndexedDocs,
  type IndexedDoc,
} from '../../../lib/docs-search-query';
import { buildApiSearchIndex } from '../../../lib/api-search-index';

const MIN_QUERY_LENGTH = 2;

export interface DocSlugEntry {
  library: string | null;
  href: string;
  scope: DocsScope;
  id: string;
  section: string;
  slug: string;
}

/** The slice of `ResolvedDoc` the indexer actually needs. */
interface ResolvableDoc {
  title: string;
  body: string;
}

function resolveDoc(entry: DocSlugEntry): ResolvableDoc | null {
  return getDocByPath(entry.href);
}

/**
 * Build the search index from a list of doc slugs.
 *
 * `resolveDoc` is a parameter — not just a closure over `lib/docs` — so a
 * test can inject a resolver that throws for one entry without touching the
 * filesystem, proving the per-document guard below actually guards.
 *
 * One malformed doc must not take down search for the whole instance: the
 * index is built once at module scope (see `getIndex`), so an uncaught throw
 * here would fail every request that instance ever serves, not just the one
 * request that happened to trigger the (re)build.
 */
export function buildIndex(
  entries: DocSlugEntry[],
  resolve: (entry: DocSlugEntry) => ResolvableDoc | null = resolveDoc
): IndexedDoc[] {
  return entries.flatMap((entry) => {
    try {
      const doc = resolve(entry);
      if (!doc) return [];
      return [
        {
          library: entry.library ?? 'docs',
          href: entry.href,
          scope: entry.scope,
          id: entry.id,
          libraryTitle:
            (entry.library
              ? getLibraryConfig(entry.library)?.title
              : 'Getting started') ??
            entry.library ??
            'Docs',
          section: entry.section,
          slug: entry.slug,
          title: doc.title,
          sections: indexDocSections(doc.body),
        },
      ];
    } catch {
      return [];
    }
  });
}

/**
 * Built once per instance, not per request.
 *
 * This reads MDX from disk at request time, which is why
 * `content/docs/**` has to be traced into the deployed function — see
 * `outputFileTracingIncludes` in next.config.ts. The route cannot be
 * statically generated the way `api/markdown` is, because the query space is
 * unbounded.
 */
let index: IndexedDoc[] | null = null;

function getIndex(): IndexedDoc[] {
  if (!index) {
    index = [...buildIndex(getAllDocSlugs()), ...buildApiSearchIndex()];
  }
  return index;
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const query = params.get('q')?.trim() ?? '';
  const framework = params.get('framework') === 'react' ? 'react' : 'angular';
  const allFrameworks = params.get('allFrameworks') === 'true';

  if (query.length < MIN_QUERY_LENGTH) {
    return NextResponse.json(
      { results: [] },
      {
        headers: {
          // Same cacheability as the populated response — a short/empty
          // query is just as deterministic a function of the corpus.
          'Cache-Control': 'public, max-age=300',
        },
      }
    );
  }

  const matching = (scope: 'angular' | 'react') =>
    searchIndexedDocs(
      getIndex().filter(
        (doc) => !doc.scope || doc.scope === 'shared' || doc.scope === scope
      ),
      query
    );
  const primary = matching(framework);
  // Broader search should expose both frameworks, even when one has many
  // matching sections. Keep each framework's relevance order and shared hits once.
  const secondary = allFrameworks
    ? matching(framework === 'react' ? 'angular' : 'react')
    : [];
  const results = allFrameworks
    ? [
        ...new Map(
          primary
            .flatMap((hit, index) => [hit, secondary[index]].filter(Boolean))
            .concat(secondary.slice(primary.length))
            .map((hit) => [hit.href, hit])
        ).values(),
      ].slice(0, 8)
    : primary;
  return NextResponse.json(
    { results },
    {
      headers: {
        // The corpus only changes on deploy, so repeated queries are served
        // by the CDN rather than waking this function.
        'Cache-Control': 'public, max-age=300',
      },
    }
  );
}
