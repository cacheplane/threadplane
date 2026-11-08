// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildIndex, GET } from './route';

const call = (q: string) =>
  GET(new Request(`http://localhost/api/docs-search?q=${encodeURIComponent(q)}`));

describe('GET /api/docs-search', () => {
  it('finds a page by a term that appears only in its body prose', async () => {
    // "checkpointer" is prose in the LangGraph persistence guide, and is in no
    // page title — exactly the query the old title-only search could not serve.
    const res = await call('checkpointer');
    expect(res.status).toBe(200);
    const { results } = await res.json();
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r: { href: string }) => r.href.includes('/docs/angular/langgraph/'))).toBe(true);
  });

  it('returns hits that carry a snippet and marks', async () => {
    const { results } = await (await call('checkpointer')).json();
    expect(typeof results[0].snippet).toBe('string');
    expect(Array.isArray(results[0].marks)).toBe(true);
  });

  it('returns a hit shaped exactly as the wire contract, no extra fields', async () => {
    const { results } = await (await call('checkpointer')).json();
    expect(Object.keys(results[0]).sort()).toEqual(
      ['href', 'title', 'heading', 'libraryTitle', 'snippet', 'marks', 'scope'].sort()
    );
  });

  it('returns empty without scanning for a query under two characters', async () => {
    const { results } = await (await call('a')).json();
    expect(results).toEqual([]);
  });

  it('searches at exactly the two-character boundary rather than short-circuiting', async () => {
    // "ag" is a real substring in this corpus (ag-ui) — proves the >= 2 path
    // actually reaches searchIndexedDocs instead of also being swallowed by
    // the short-query guard.
    const { results } = await (await call('ag')).json();
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns empty for a missing query parameter', async () => {
    const res = await GET(new Request('http://localhost/api/docs-search'));
    const { results } = await res.json();
    expect(results).toEqual([]);
  });

  it('treats a whitespace-only query the same as an empty one', async () => {
    const { results } = await (await call('   ')).json();
    expect(results).toEqual([]);
  });

  it('is cacheable, because the corpus only changes on deploy', async () => {
    const res = await call('streaming');
    expect(res.headers.get('cache-control')).toContain('max-age=');
  });

  it('sets Cache-Control on the empty-result response too, not only populated ones', async () => {
    const res = await call('a');
    expect(res.headers.get('cache-control')).toContain('max-age=');
  });
});

describe('buildIndex', () => {
  it('skips a single document that throws without breaking the rest of the corpus', () => {
    const entries = [
      { id: 'lib/guides/good', scope: 'angular' as const, href: '/docs/angular/lib/guides/good', library: 'lib', section: 'guides', slug: 'good' },
      { id: 'lib/guides/bad', scope: 'angular' as const, href: '/docs/angular/lib/guides/bad', library: 'lib', section: 'guides', slug: 'bad' },
    ];

    const result = buildIndex(entries, (entry) => {
      if (entry.slug === 'bad') {
        throw new Error('simulated malformed doc');
      }
      return { title: 'Good Doc', body: '# Good Doc\n\nSome findable prose here.' };
    });

    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe('good');
  });
});


it('defaults to selected-framework and shared content, with an explicit wider search', async () => {
  const request = (all = false) => new Request(`http://localhost/api/docs-search?q=streaming&framework=react&allFrameworks=${all}`);
  const scoped = await (await GET(request())).json();
  expect(scoped.results.length).toBeGreaterThan(0);
  expect(scoped.results.every((hit: {scope: string}) => ['react', 'shared'].includes(hit.scope))).toBe(true);
  expect(scoped.results.some((hit: {href: string}) => hit.href.startsWith('/docs/react/'))).toBe(true);
  const all = await (await GET(request(true))).json();
  expect(all.results.some((hit: {scope: string}) => hit.scope === 'angular')).toBe(true);
  expect(all.results.some((hit: {scope: string}) => hit.scope === 'react')).toBe(true);
});
