export type DocsFramework = 'angular' | 'react';

/** A logical topic, independent of its source file or optional runnable lesson. */
export type DocsNarrativeIdentity =
  | { scope: 'framework'; framework: DocsFramework; slug: readonly string[] }
  | { scope: 'shared'; slug: readonly string[] };

function isDocsFramework(value: string): value is DocsFramework {
  return value === 'angular' || value === 'react';
}

function encodeSegment(segment: string): string {
  // Percent signs cannot enter a logical slug: this also rejects nested URL
  // escapes rather than allowing a later decode to introduce traversal.
  if (
    typeof segment !== 'string' ||
    segment.length === 0 ||
    segment.trim() !== segment ||
    segment === '.' ||
    segment === '..' ||
    /[/\\%\p{Cc}]/u.test(segment)
  ) {
    throw new Error('Invalid documentation slug segment');
  }
  return encodeURIComponent(segment);
}

/** Build a root-relative narrative href. Invalid identities throw. */
export function docsNarrativeHref(identity: DocsNarrativeIdentity): string {
  if (
    !identity ||
    !Array.isArray(identity.slug) ||
    identity.slug.length === 0
  ) {
    throw new Error('A documentation narrative requires a nonempty slug');
  }
  let scope: DocsFramework | 'shared';
  if (identity.scope === 'shared') {
    scope = 'shared';
  } else if (
    identity.scope === 'framework' &&
    isDocsFramework(identity.framework)
  ) {
    scope = identity.framework;
  } else {
    throw new Error('Invalid documentation scope or framework');
  }
  return `/docs/${scope}/${Array.from(identity.slug, encodeSegment).join('/')}`;
}

/**
 * Parse root-relative narrative paths without normalizing them as URLs.
 * Query and fragment data never select a framework. Landing, API, adapter
 * selection, and retired narrative routes are deliberately outside this parser.
 */
export function parseDocsNarrativePath(
  path: string
): DocsNarrativeIdentity | null {
  const [pathname] = path.split(/[?#]/, 1);
  const [root, docs, scope, ...segments] = pathname.split('/');
  if (
    root !== '' ||
    docs !== 'docs' ||
    (scope !== 'shared' && !isDocsFramework(scope)) ||
    segments.length === 0
  ) {
    return null;
  }
  try {
    const slug = segments.map((segment) => decodeURIComponent(segment));
    slug.forEach(encodeSegment);
    return scope === 'shared'
      ? { scope: 'shared', slug }
      : { scope: 'framework', framework: scope, slug };
  } catch {
    return null;
  }
}
