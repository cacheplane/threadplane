import { describe, expect, it } from 'vitest';
import { searchIndexedDocs, type IndexedDoc } from './docs-search-query';

const DOCS: IndexedDoc[] = [
  {
    library: 'langgraph',
    libraryTitle: 'LangGraph',
    section: 'guides',
    slug: 'persistence',
    title: 'Persistence',
    sections: [
      { heading: null, anchor: null, text: 'How threads survive a restart.' },
      {
        heading: 'Production checkpointers',
        anchor: 'production-checkpointers',
        text: 'Use a Postgres checkpointer in production rather than memory.',
      },
    ],
  },
  {
    library: 'chat',
    libraryTitle: 'Chat',
    section: 'guides',
    slug: 'checkpointer',
    title: 'Checkpointer',
    sections: [{ heading: null, anchor: null, text: 'Unrelated prose.' }],
  },
];

describe('searchIndexedDocs', () => {
  it('finds a term that appears only in body prose', () => {
    const hits = searchIndexedDocs(DOCS, 'postgres');
    expect(hits).toHaveLength(1);
    expect(hits[0].href).toBe('/docs/angular/langgraph/guides/persistence#production-checkpointers');
    expect(hits[0].heading).toBe('Production checkpointers');
  });

  it('ranks a title match above a body match', () => {
    const hits = searchIndexedDocs(DOCS, 'checkpointer');
    expect(hits[0].title).toBe('Checkpointer');
  });

  it('links to the page top when the match is in the preamble', () => {
    const hits = searchIndexedDocs(DOCS, 'restart');
    expect(hits[0].href).toBe('/docs/angular/langgraph/guides/persistence');
  });

  it('requires every token, matching the instant layer', () => {
    expect(searchIndexedDocs(DOCS, 'postgres nonexistent')).toEqual([]);
  });

  it('returns nothing for a query of only stop words', () => {
    expect(searchIndexedDocs(DOCS, 'of the')).toEqual([]);
  });

  it('returns a snippet with offsets covering the matched term', () => {
    const [hit] = searchIndexedDocs(DOCS, 'postgres');
    expect(hit.snippet).toContain('Postgres');
    expect(hit.marks.length).toBeGreaterThan(0);
    const [start, end] = hit.marks[0];
    expect(hit.snippet.slice(start, end).toLowerCase()).toBe('postgres');
  });

  it('caps results at eight, matching the existing result list', () => {
    const many: IndexedDoc[] = Array.from({ length: 12 }, (_, i) => ({
      library: 'chat',
      libraryTitle: 'Chat',
      section: 'guides',
      slug: `page-${i}`,
      title: `Page ${i}`,
      sections: [{ heading: null, anchor: null, text: 'streaming prose' }],
    }));
    expect(searchIndexedDocs(many, 'streaming')).toHaveLength(8);
  });

  it('does not render a section whose text is shorter than the snippet window with stray ellipses', () => {
    const short: IndexedDoc[] = [
      {
        library: 'chat',
        libraryTitle: 'Chat',
        section: 'guides',
        slug: 'short',
        title: 'Short',
        sections: [{ heading: null, anchor: null, text: 'A short bit of streaming prose.' }],
      },
    ];
    const [hit] = searchIndexedDocs(short, 'streaming');
    expect(hit.snippet).toBe('A short bit of streaming prose.');
    expect(hit.snippet.startsWith('…')).toBe(false);
    expect(hit.snippet.endsWith('…')).toBe(false);
  });

  it('finds a hit whose only match is the page title, not any section text', () => {
    const titleOnly: IndexedDoc[] = [
      {
        library: 'chat',
        libraryTitle: 'Chat',
        section: 'guides',
        slug: 'zeta-widget',
        title: 'Zeta Widget',
        sections: [{ heading: null, anchor: null, text: 'Nothing relevant here.' }],
      },
    ];
    const hits = searchIndexedDocs(titleOnly, 'zeta');
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe('Zeta Widget');
  });

  it('keeps a deterministic order for hits tied on score and length', () => {
    const tied: IndexedDoc[] = [
      {
        library: 'chat',
        libraryTitle: 'Chat',
        section: 'guides',
        slug: 'alpha',
        title: 'Alpha',
        sections: [{ heading: null, anchor: null, text: 'streaming prose here' }],
      },
      {
        library: 'chat',
        libraryTitle: 'Chat',
        section: 'guides',
        slug: 'beta',
        title: 'Beta',
        sections: [{ heading: null, anchor: null, text: 'streaming prose here' }],
      },
    ];
    const first = searchIndexedDocs(tied, 'streaming').map((h) => h.title);
    const second = searchIndexedDocs(tied, 'streaming').map((h) => h.title);
    expect(first).toEqual(second);
    expect(first).toEqual(['Alpha', 'Beta']);
  });

  it('does not emit overlapping marks when one token is a substring of another', () => {
    const overlap: IndexedDoc[] = [
      {
        library: 'chat',
        libraryTitle: 'Chat',
        section: 'guides',
        slug: 'agents',
        title: 'Agents',
        sections: [{ heading: null, anchor: null, text: 'Configure agents and their agent tools.' }],
      },
    ];
    const [hit] = searchIndexedDocs(overlap, 'agent agents');
    for (let i = 1; i < hit.marks.length; i++) {
      expect(hit.marks[i][0]).toBeGreaterThanOrEqual(hit.marks[i - 1][1]);
    }
  });

  it('matches and scores case-insensitively across mixed-case title, heading and body', () => {
    const mixedCase: IndexedDoc[] = [
      {
        library: 'chat',
        libraryTitle: 'Chat',
        section: 'guides',
        slug: 'mixed-case',
        title: 'MIXEDcase Widget',
        sections: [
          {
            heading: 'ConFig Section',
            anchor: 'config-section',
            text: 'Some Prose mentioning WIDGET behavior in a Sentence.',
          },
        ],
      },
    ];
    const hits = searchIndexedDocs(mixedCase, 'widget');
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe('MIXEDcase Widget');
    // Matches in all three fields (title, heading via a second query below,
    // and body) must all be found regardless of the query's or the source
    // text's casing -- a half-converted lower-casing refactor would make
    // exactly one of these fields silently case-sensitive.
    const headingHits = searchIndexedDocs(mixedCase, 'CONFIG');
    expect(headingHits).toHaveLength(1);
    const bodyHits = searchIndexedDocs(mixedCase, 'SENTENCE');
    expect(bodyHits).toHaveLength(1);
  });
});
