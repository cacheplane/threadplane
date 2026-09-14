import { getCanonicalUrl, ogImagePath, resolveModifiedTime, SITE_NAME } from './site-metadata';
import { SHORT_POSITIONING_DESCRIPTION } from './positioning';
import type { Author } from './blog-authors';

/** A single schema.org node, ready to be serialized into a `ld+json` script. */
export type JsonLdNode = Record<string, unknown>;

const SCHEMA_CONTEXT = 'https://schema.org';

/**
 * The canonical repository. Verified public; the npm *organization* page is
 * member-gated, so `sameAs` links the public package page instead.
 */
export const REPOSITORY_URL = 'https://github.com/cacheplane/threadplane';

/**
 * Stable identity for the publisher node. Every other node refers to the
 * Organization by `@id` rather than repeating it, which is the schema.org way
 * to express "same entity" across nodes.
 *
 * Those references only resolve if the Organization node is present in the same
 * page's structured data. {@link rootJsonLd} is what guarantees that: it bundles
 * Organization with the other root nodes into one `@graph`, so a caller cannot
 * mount a referring node without its referent.
 *
 * Computed at module load, which is safe because {@link getCanonicalUrl}
 * resolves against a hardcoded `SITE_ORIGIN` constant — no env lookup, no
 * request context, identical on server and client.
 */
const ORGANIZATION_ID = `${getCanonicalUrl('/')}#organization`;

export function organizationJsonLd() {
  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'Organization',
    '@id': ORGANIZATION_ID,
    name: SITE_NAME,
    url: getCanonicalUrl('/'),
    // A real square mark now ships at `public/brand/logo-512.png`: the paper
    // plane knocked out of a navy field, the same art the favicon rasterises
    // from. The social card is deliberately still not used here — it is a
    // 1200x630 marketing image, not a mark.
    description:
      'Threadplane builds the Angular UI layer for production agent applications on LangGraph and AG-UI-compatible runtimes.',
    sameAs: [REPOSITORY_URL, 'https://www.npmjs.com/package/@threadplane/chat'],
  };
}

export function websiteJsonLd() {
  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'WebSite',
    '@id': `${getCanonicalUrl('/')}#website`,
    name: SITE_NAME,
    url: getCanonicalUrl('/'),
    logo: getCanonicalUrl('/brand/logo-512.png'),
    description: SHORT_POSITIONING_DESCRIPTION,
    publisher: { '@id': ORGANIZATION_ID },
  };
}

export function softwareSourceCodeJsonLd() {
  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'SoftwareSourceCode',
    name: '@threadplane/chat',
    description:
      'Signal-native Angular chat UI primitives bound to a runtime-neutral Agent contract, with adapters for LangGraph and AG-UI.',
    programmingLanguage: 'TypeScript',
    runtimePlatform: 'Angular',
    codeRepository: REPOSITORY_URL,
    author: { '@id': ORGANIZATION_ID },
    license: `${REPOSITORY_URL}/blob/main/LICENSE`,
  };
}

/**
 * The site-wide nodes, bundled into a single `@graph` so they are physically
 * inseparable: mounting this cannot orphan the `@id` references that WebSite and
 * SoftwareSourceCode make to the Organization, because the Organization travels
 * with them. `@graph` is the conventional shape for a multi-entity page and
 * consumers parse it identically to sibling nodes.
 *
 * Mounted once, in the root layout.
 */
export function rootJsonLd() {
  // Annotated: the graph is deliberately heterogeneous, so `JsonLdNode[]` is the
  // honest element type. The individual builders keep their inferred shapes.
  const nodes: JsonLdNode[] = [organizationJsonLd(), websiteJsonLd(), softwareSourceCodeJsonLd()];
  return {
    '@context': SCHEMA_CONTEXT,
    // One `@context` for the whole graph; repeating it per node is redundant.
    // Per-route builders keep theirs, since they are mounted standalone.
    '@graph': nodes.map((node) => {
      const stripped = { ...node };
      delete stripped['@context'];
      return stripped;
    }),
  };
}

/**
 * The /about route, named once. `aboutPageJsonLd` mints the Person `@id` from
 * it and `blogPostingJsonLd` points every author at it, so the attribution link
 * and its target cannot drift apart.
 */
const ABOUT_PATH = '/about';

/**
 * Stable identity for the site's author node. Both {@link aboutPageJsonLd} and
 * every BlogPosting byline stamp it, which is what makes them one entity to a
 * consumer rather than two nodes that merely share a name.
 */
export const PERSON_ID = `${getCanonicalUrl(ABOUT_PATH)}#person`;

/**
 * The /about page and the Person it is about, as one `@graph`.
 *
 * Bundled for the same reason as {@link rootJsonLd}: the AboutPage's
 * `mainEntity` reference cannot be orphaned if the Person travels with it.
 *
 * `worksFor` refers to the Organization by `@id` rather than repeating it,
 * which resolves because the root layout mounts {@link rootJsonLd} — including
 * the Organization node — on every page of the site.
 *
 * Every field is derived from the caller's {@link Author} record; nothing about
 * the person is stated here.
 */
/**
 * The external profiles an author record actually names, as absolute URLs.
 *
 * Order is stable so the emitted JSON-LD does not churn between builds.
 */
function personProfiles(author: Author): string[] {
  return [
    author.github && `https://github.com/${author.github}`,
    author.twitter && `https://x.com/${author.twitter}`,
    author.linkedin && `https://www.linkedin.com/in/${author.linkedin}`,
  ].filter((url): url is string => Boolean(url));
}

export function aboutPageJsonLd(author: Author) {
  const url = getCanonicalUrl(ABOUT_PATH);
  const person: JsonLdNode = {
    '@type': 'Person',
    '@id': PERSON_ID,
    name: author.name,
    url,
    ...(author.role ? { jobTitle: author.role } : {}),
    ...(author.bio ? { description: author.bio } : {}),
    // Only profiles the repo actually knows about; `sameAs` is an identity
    // claim, so a guessed profile is a false one. Each handle is a separate
    // opt-in field — one is never derived from another.
    ...(personProfiles(author).length ? { sameAs: personProfiles(author) } : {}),
    ...(author.knowsAbout?.length ? { knowsAbout: [...author.knowsAbout] } : {}),
    worksFor: { '@id': ORGANIZATION_ID },
  };

  return {
    '@context': SCHEMA_CONTEXT,
    '@graph': [
      {
        '@type': 'AboutPage',
        '@id': `${url}#webpage`,
        url,
        name: `About ${author.name}`,
        mainEntity: { '@id': PERSON_ID },
        isPartOf: { '@id': `${getCanonicalUrl('/')}#website` },
        publisher: { '@id': ORGANIZATION_ID },
      },
      person,
    ],
  };
}

/** The subset of a blog post that schema.org cares about. */
export interface BlogPostingInput {
  title: string;
  description: string;
  slug: string;
  /** ISO 8601 publish date or timestamp. */
  datePublished: string;
  /** ISO 8601 last-modified timestamp; falls back to `datePublished`. */
  dateModified?: string;
  authorName: string;
  tags?: string[];
}

export function blogPostingJsonLd(post: BlogPostingInput) {
  const url = getCanonicalUrl(`/blog/${post.slug}`);
  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    url,
    mainEntityOfPage: url,
    datePublished: post.datePublished,
    dateModified: resolveModifiedTime(post.datePublished, post.dateModified),
    // Per-post card, matching the `og:image` that `generateMetadata` emits.
    image: getCanonicalUrl(ogImagePath(post.slug)),
    // Omitted rather than left undefined, matching `dateModified` below.
    ...(post.tags?.length ? { keywords: post.tags } : {}),
    // The same `@id` the /about Person declares, so a byline and that page are
    // one entity rather than two similarly-named nodes. The node stays inline
    // (rather than a bare `@id` reference) because nothing on a post page
    // defines the Person, and `url` is what makes the identity followable.
    author: {
      '@type': 'Person',
      '@id': PERSON_ID,
      name: post.authorName,
      url: getCanonicalUrl(ABOUT_PATH),
    },
    publisher: { '@id': ORGANIZATION_ID },
  };
}

/** The subset of a docs page that schema.org cares about. */
export interface TechArticleInput {
  title: string;
  description: string;
  pathname: string;
  /** ISO 8601 last-modified timestamp; omitted from the node when unknown. */
  dateModified?: string;
}

export function techArticleJsonLd(doc: TechArticleInput) {
  const url = getCanonicalUrl(doc.pathname);
  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'TechArticle',
    headline: doc.title,
    description: doc.description,
    url,
    mainEntityOfPage: url,
    ...(doc.dateModified ? { dateModified: doc.dateModified } : {}),
    author: { '@id': ORGANIZATION_ID },
    publisher: { '@id': ORGANIZATION_ID },
    proficiencyLevel: 'Expert',
  };
}

/** One rung of a breadcrumb trail, from the site root down to the current page. */
export interface BreadcrumbCrumb {
  name: string;
  pathname: string;
}

export function breadcrumbJsonLd(crumbs: BreadcrumbCrumb[]) {
  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: getCanonicalUrl(crumb.pathname),
    })),
  };
}
