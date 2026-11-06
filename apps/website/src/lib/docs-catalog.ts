import authoredDocuments from '../../content/docs-catalog.json';
import {
  docsNarrativeHref,
  parseDocsNarrativePath,
  type DocsFramework,
} from '@threadplane/cockpit-registry/docs-routes';

export type DocsScope = DocsFramework | 'shared';

export interface DocumentSource {
  /** Optional registered example; article availability never depends on it. */
  lessonId?: string;
  apiEntrypointIds?: string[];
  /** Relative to content/docs; source resolution stays on the server. */
  source: string;
  description: string;
}

export interface NarrativeDocument {
  /** Stable logical topic identity, independent of framework and runnable examples. */
  id: string;
  title: string;
  library: string | null;
  section: string;
  slug: string;
  order: number;
  variants: Partial<Record<DocsScope, DocumentSource>>;
}

export interface DocumentVariant
  extends DocumentSource,
    Omit<NarrativeDocument, 'variants'> {
  scope: DocsScope;
  href: string;
}

/** Metadata only: safe for navigation clients; no MDX, filesystem, or runtime registry imports. */
export const documentCatalog: readonly NarrativeDocument[] = authoredDocuments;

export function getDocumentVariant(
  id: string,
  scope: DocsScope
): DocumentVariant | undefined {
  const document = documentCatalog.find((entry) => entry.id === id);
  const variant = document?.variants[scope];
  if (!document || !variant) return undefined;
  const { id: documentId, title, library, section, slug, order } = document;
  return {
    id: documentId,
    title,
    library,
    section,
    slug,
    order,
    ...variant,
    scope,
    href: docsNarrativeHref(
      scope === 'shared'
        ? { scope: 'shared', slug: id.split('/') }
        : { scope: 'framework', framework: scope, slug: id.split('/') }
    ),
  };
}

export function getNarrativeDocuments(scope?: DocsScope): DocumentVariant[] {
  return documentCatalog
    .flatMap((document) =>
      (scope
        ? [scope]
        : (Object.keys(document.variants) as DocsScope[])
      ).flatMap((selected) => {
        const variant = getDocumentVariant(document.id, selected);
        return variant ? [variant] : [];
      })
    )
    .sort((left, right) => left.order - right.order);
}

/** Shared documents keep their one canonical identity in either framework's navigation. */
export function getFrameworkDocuments(
  framework: DocsFramework
): DocumentVariant[] {
  return getNarrativeDocuments().filter(
    (document) => document.scope === framework || document.scope === 'shared'
  );
}

/** A missing variant is unavailable, never a fallback to another framework's article. */
export function resolveNarrativeDocument(
  pathname: string
): DocumentVariant | undefined {
  const identity = parseDocsNarrativePath(pathname);
  if (!identity) return undefined;
  return getDocumentVariant(
    identity.slug.join('/'),
    identity.scope === 'shared' ? 'shared' : identity.framework
  );
}
