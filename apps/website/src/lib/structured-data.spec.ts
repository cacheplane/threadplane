import { describe, expect, it } from 'vitest';
import {
  breadcrumbJsonLd,
  organizationJsonLd,
  rootJsonLd,
  softwareSourceCodeJsonLd,
  techArticleJsonLd,
  aboutPageJsonLd,
  PERSON_ID,
  websiteJsonLd,
  blogPostingJsonLd,
  type JsonLdNode,
} from './structured-data';
import { blogAuthors } from './blog-authors';

const ORGANIZATION_ID = 'https://threadplane.ai/#organization';

const SAMPLE_POST = {
  title: 'A Post',
  description: 'About things.',
  slug: 'a-post',
  datePublished: '2026-08-13',
  authorName: 'Brian Love',
} as const;

const SAMPLE_DOC = {
  title: 'Installation',
  description: 'Install it.',
  pathname: '/docs/chat/getting-started/installation',
} as const;

/** Every builder's output must survive a JSON round-trip unchanged. */
function expectSerializable<T extends JsonLdNode>(data: T): Record<string, unknown> {
  const json = JSON.stringify(data);
  expect(() => JSON.parse(json)).not.toThrow();
  const parsed = JSON.parse(json) as Record<string, unknown>;
  // The real assertion: nothing is lost or invented by serialization. This is
  // what catches an `undefined`-valued key that `JSON.stringify` silently drops.
  expect(parsed).toStrictEqual(data);
  return parsed;
}

describe('organizationJsonLd', () => {
  it('describes Threadplane with an absolute url', () => {
    const data = organizationJsonLd();
    expect(data['@type']).toBe('Organization');
    expect(data['name']).toBe('Threadplane');
    expect(String(data['url'])).toBe('https://threadplane.ai/');
  });

  it('omits logo entirely rather than passing off the social card as a mark', () => {
    expect('logo' in organizationJsonLd()).toBe(false);
  });

  it('links only to absolute https profile urls', () => {
    const sameAs = organizationJsonLd()['sameAs'];
    expect(sameAs).toContain('https://github.com/cacheplane/threadplane');
    for (const url of sameAs) expect(url).toMatch(/^https:\/\//);
  });

  it('serializes to JSON', () => {
    expect(expectSerializable(organizationJsonLd())['@context']).toBe('https://schema.org');
  });
});

describe('websiteJsonLd', () => {
  it('is a WebSite node pointing at the origin', () => {
    expect(websiteJsonLd()['@type']).toBe('WebSite');
  });

  it('serializes to JSON', () => {
    expectSerializable(websiteJsonLd());
  });
});

describe('rootJsonLd', () => {
  it('bundles the three site-wide nodes into one @graph', () => {
    const graph = rootJsonLd()['@graph'];
    expect(graph.map((node) => node['@type'])).toEqual([
      'Organization',
      'WebSite',
      'SoftwareSourceCode',
    ]);
  });

  it('carries a single @context for the whole graph', () => {
    const data = rootJsonLd();
    expect(data['@context']).toBe('https://schema.org');
    for (const node of data['@graph']) expect('@context' in node).toBe(false);
  });

  it('resolves every @id reference inside the graph it ships', () => {
    const graph = rootJsonLd()['@graph'];
    const ids = new Set(graph.map((node) => node['@id']).filter(Boolean));
    expect(ids.has(ORGANIZATION_ID)).toBe(true);

    // The referring nodes point at a node that is physically in this same graph.
    const website = graph.find((node) => node['@type'] === 'WebSite');
    const software = graph.find((node) => node['@type'] === 'SoftwareSourceCode');
    expect((website?.['publisher'] as JsonLdNode)['@id']).toBe(ORGANIZATION_ID);
    expect((software?.['author'] as JsonLdNode)['@id']).toBe(ORGANIZATION_ID);
  });

  it('serializes to JSON', () => {
    expectSerializable(rootJsonLd());
  });
});

describe('blogPostingJsonLd', () => {
  it('carries headline, dates, author, and absolute urls', () => {
    const data = blogPostingJsonLd({ ...SAMPLE_POST, tags: ['angular'] });
    expect(data['@type']).toBe('BlogPosting');
    expect(data['headline']).toBe('A Post');
    expect(data['datePublished']).toBe('2026-08-13');
    expect(data['dateModified']).toBe('2026-08-13');
    expect(data['author']['name']).toBe('Brian Love');
    // Attribution is only a real signal when the author resolves to a page. The
    // /about route exists, so the byline links to it.
    expect(data['author']['url']).toBe('https://threadplane.ai/about');
    expect(String(data['url'])).toBe('https://threadplane.ai/blog/a-post');
  });

  it('prefers an explicit dateModified when one is known', () => {
    const data = blogPostingJsonLd({ ...SAMPLE_POST, dateModified: '2026-08-19' });
    expect(data['dateModified']).toBe('2026-08-19');
  });

  it('points image at the per-post opengraph-image route', () => {
    // Shares `ogImagePath` with the `image` that `blog/[slug]/page.tsx` hands
    // `createPageMetadata`, so og:image and the BlogPosting cannot drift.
    expect(blogPostingJsonLd(SAMPLE_POST)['image']).toBe(
      'https://threadplane.ai/blog/a-post/opengraph-image',
    );
  });

  it('omits keywords entirely for an untagged post', () => {
    expect('keywords' in blogPostingJsonLd(SAMPLE_POST)).toBe(false);
    expect('keywords' in blogPostingJsonLd({ ...SAMPLE_POST, tags: [] })).toBe(false);
  });

  it('serializes to JSON', () => {
    expectSerializable(blogPostingJsonLd(SAMPLE_POST));
    expectSerializable(blogPostingJsonLd({ ...SAMPLE_POST, tags: ['angular'] }));
  });
});

describe('techArticleJsonLd', () => {
  it('describes a docs page', () => {
    const data = techArticleJsonLd(SAMPLE_DOC);
    expect(data['@type']).toBe('TechArticle');
    expect(String(data['url'])).toBe('https://threadplane.ai/docs/chat/getting-started/installation');
  });

  it('omits dateModified entirely when none is known', () => {
    expect('dateModified' in techArticleJsonLd(SAMPLE_DOC)).toBe(false);
  });

  it('serializes to JSON', () => {
    expectSerializable(techArticleJsonLd(SAMPLE_DOC));
    expectSerializable(techArticleJsonLd({ ...SAMPLE_DOC, dateModified: '2026-08-19' }));
  });
});

describe('breadcrumbJsonLd', () => {
  it('numbers positions from 1 and resolves absolute urls', () => {
    const items = breadcrumbJsonLd([
      { name: 'Docs', pathname: '/docs' },
      { name: 'Chat', pathname: '/docs/chat' },
    ])['itemListElement'];
    expect(items).toHaveLength(2);
    expect(items[0]['position']).toBe(1);
    expect(String(items[1]['item'])).toBe('https://threadplane.ai/docs/chat');
  });

  it('emits an empty itemListElement for an empty trail', () => {
    // Documenting, not endorsing: Google rejects a BreadcrumbList with no items.
    // No runtime guard here on purpose — task 8 owns the call sites and must not
    // hand this builder an empty array.
    expect(breadcrumbJsonLd([])['itemListElement']).toEqual([]);
  });

  it('serializes to JSON', () => {
    expectSerializable(breadcrumbJsonLd([{ name: 'Docs', pathname: '/docs' }]));
  });
});

describe('softwareSourceCodeJsonLd', () => {
  it('marks Threadplane as an Angular TypeScript library', () => {
    const data = softwareSourceCodeJsonLd();
    expect(data['@type']).toBe('SoftwareSourceCode');
    expect(data['programmingLanguage']).toBe('TypeScript');
  });

  it('points at the real repository', () => {
    expect(softwareSourceCodeJsonLd()['codeRepository']).toBe(
      'https://github.com/cacheplane/threadplane',
    );
  });

  it('serializes to JSON', () => {
    expectSerializable(softwareSourceCodeJsonLd());
  });
});

describe('aboutPageJsonLd', () => {
  const AUTHOR = {
    name: 'Brian Love',
    role: 'Founder, Threadplane',
    bio: 'Angular consultant and open-source maintainer.',
    github: 'blove',
    knowsAbout: ['Angular'],
  };

  function nodes() {
    return aboutPageJsonLd(AUTHOR)['@graph'] as JsonLdNode[];
  }

  it('bundles an AboutPage whose mainEntity is the Person it ships with', () => {
    const graph = nodes();
    const about = graph.find((node) => node['@type'] === 'AboutPage');
    const person = graph.find((node) => node['@type'] === 'Person');
    expect(about).toBeDefined();
    expect(person).toBeDefined();
    // The reference resolves inside this same graph — that is the point of
    // emitting them together.
    expect((about?.['mainEntity'] as JsonLdNode)['@id']).toBe(person?.['@id']);
    expect(person?.['@id']).toBe(PERSON_ID);
  });

  it('states nothing about the person that the author record does not', () => {
    const person = nodes().find((node) => node['@type'] === 'Person') as JsonLdNode;
    expect(person['name']).toBe(AUTHOR.name);
    expect(person['jobTitle']).toBe(AUTHOR.role);
    expect(person['description']).toBe(AUTHOR.bio);
    // The fixture names only a GitHub handle, so only that profile may appear.
    expect(person['sameAs']).toEqual(['https://github.com/blove']);
    expect(person['url']).toBe('https://threadplane.ai/about');
  });

  it('omits profile, title, and bio fields for an author record that lacks them', () => {
    const graph = aboutPageJsonLd({ name: 'Anon' })['@graph'] as JsonLdNode[];
    const person = graph.find((node) => node['@type'] === 'Person') as JsonLdNode;
    expect('sameAs' in person).toBe(false);
    expect('jobTitle' in person).toBe(false);
    expect('description' in person).toBe(false);
    expect('knowsAbout' in person).toBe(false);
  });

  it('references the Organization the root layout mounts', () => {
    const person = nodes().find((node) => node['@type'] === 'Person') as JsonLdNode;
    expect((person['worksFor'] as JsonLdNode)['@id']).toBe(ORGANIZATION_ID);
  });

  it('omits a profile the author record does not name', () => {
    // Each handle is opt-in per field: an author with only a GitHub handle must
    // not acquire an invented X or LinkedIn URL.
    const graph = aboutPageJsonLd({ name: 'Anon', github: 'anon' })['@graph'] as JsonLdNode[];
    const person = graph.find((node) => node['@type'] === 'Person') as JsonLdNode;
    expect(person['sameAs']).toEqual(['https://github.com/anon']);
  });

  it('resolves the real site author to real profiles', () => {
    // The page passes `blogAuthors['brian']`; `sameAs` is an identity claim, so
    // this pins the profiles the repo actually knows rather than the fixture's.
    const graph = aboutPageJsonLd(blogAuthors['brian'])['@graph'] as JsonLdNode[];
    const person = graph.find((node) => node['@type'] === 'Person') as JsonLdNode;
    expect(person['sameAs']).toEqual([
      'https://github.com/blove',
      'https://x.com/blovedev',
      'https://www.linkedin.com/in/blove',
    ]);
  });

  it('serializes to JSON', () => {
    expectSerializable(aboutPageJsonLd(AUTHOR));
  });
});

/**
 * Cross-cutting invariants. Asserting these per-builder is what stops one
 * builder from quietly drifting — a dropped `@context` or a `#Organization`
 * typo in a single node would otherwise sail through.
 */
describe('shared node invariants', () => {
  const standaloneBuilders: [string, () => JsonLdNode][] = [
    ['organizationJsonLd', organizationJsonLd],
    ['websiteJsonLd', websiteJsonLd],
    ['softwareSourceCodeJsonLd', softwareSourceCodeJsonLd],
    ['blogPostingJsonLd', () => blogPostingJsonLd(SAMPLE_POST)],
    ['techArticleJsonLd', () => techArticleJsonLd(SAMPLE_DOC)],
    ['breadcrumbJsonLd', () => breadcrumbJsonLd([{ name: 'Docs', pathname: '/docs' }])],
  ];

  it.each(standaloneBuilders)('%s declares the schema.org @context', (_name, build) => {
    expect(build()['@context']).toBe('https://schema.org');
  });

  it.each(standaloneBuilders)('%s declares an @type', (_name, build) => {
    expect(typeof build()['@type']).toBe('string');
  });

  // Every node that names the Organization must name the *same* Organization.
  const organizationReferences: [string, string, () => JsonLdNode][] = [
    ['websiteJsonLd', 'publisher', websiteJsonLd],
    ['softwareSourceCodeJsonLd', 'author', softwareSourceCodeJsonLd],
    ['blogPostingJsonLd', 'publisher', () => blogPostingJsonLd(SAMPLE_POST)],
    ['techArticleJsonLd', 'author', () => techArticleJsonLd(SAMPLE_DOC)],
    ['techArticleJsonLd', 'publisher', () => techArticleJsonLd(SAMPLE_DOC)],
  ];

  it.each(organizationReferences)('%s.%s references the Organization by @id', (_name, key, build) => {
    expect((build()[key] as JsonLdNode)['@id']).toBe(ORGANIZATION_ID);
  });

  // The byline and the /about page are the same person, and say so with the
  // same `@id`. A shared name alone would leave a consumer two nodes to guess at.
  it('gives a BlogPosting author the id the /about Person declares', () => {
    const byline = blogPostingJsonLd(SAMPLE_POST)['author'] as JsonLdNode;
    const graph = aboutPageJsonLd(blogAuthors['brian'])['@graph'] as JsonLdNode[];
    const person = graph.find((node) => node['@type'] === 'Person') as JsonLdNode;
    expect(byline['@id']).toBe(person['@id']);
    expect(byline['@id']).toBe(PERSON_ID);
  });

  it('references the id the Organization node actually declares', () => {
    expect(organizationJsonLd()['@id']).toBe(ORGANIZATION_ID);
  });
});
