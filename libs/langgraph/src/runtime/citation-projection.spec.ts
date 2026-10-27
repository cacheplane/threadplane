import { describe, expect, it } from 'vitest';
import { projectCitations } from './citation-projection';

const project = (citations: unknown) =>
  projectCitations({ additional_kwargs: { citations } });

describe('owned citation normalization', () => {
  it('normalizes aliases and deterministic positions without inventing source facts', () => {
    expect(
      project([
        'https://example.test/one',
        {
          refId: 'ref',
          index: 4.5,
          name: 'Name',
          href: '/two',
          content: 'Excerpt',
          sourceType: 'web',
          iconUrl: '/icon',
          publishedAt: '2026-09-24',
        },
        {
          id: 'primary',
          refId: 'ignored',
          title: '',
          name: 'ignored',
          url: '',
          href: 'ignored',
          snippet: '',
          excerpt: 'ignored',
          publishedAt: 42,
        },
        { source: '/four', excerpt: 'Four' },
        null,
      ])
    ).toEqual([
      { id: 'c1', index: 1, url: 'https://example.test/one' },
      {
        id: 'ref',
        index: 4.5,
        title: 'Name',
        url: '/two',
        snippet: 'Excerpt',
        sourceType: 'web',
        iconUrl: '/icon',
        publishedAt: '2026-09-24',
      },
      {
        id: 'primary',
        index: 3,
        title: '',
        url: '',
        snippet: '',
        publishedAt: 42,
      },
      { id: 'c4', index: 4, url: '/four', snippet: 'Four' },
      { id: 'c5', index: 5 },
    ]);
  });

  it('preserves absent versus empty and nullish precedence over sources', () => {
    expect(projectCitations({})).toBeUndefined();
    expect(
      projectCitations({
        additional_kwargs: { citations: [], sources: ['ignored'] },
      })
    ).toEqual([]);
    expect(
      projectCitations({
        additional_kwargs: { citations: null, sources: ['source'] },
      })
    ).toEqual([{ id: 'c1', index: 1, url: 'source' }]);
    expect(
      projectCitations({
        additional_kwargs: { citations: 'unsupported', sources: ['ignored'] },
      })
    ).toBeUndefined();
  });

  it('omits unsupported optional fields and accepts only finite numeric indexes and timestamps', () => {
    expect(
      project([
        { index: Infinity, publishedAt: NaN, title: 4, extra: 'ignored' },
        { index: NaN, publishedAt: new Date() },
        { index: -2, publishedAt: 0 },
      ])
    ).toEqual([
      { id: 'c1', index: 1 },
      { id: 'c2', index: 2 },
      { id: 'c3', index: -2, publishedAt: 0 },
    ]);
  });

  it('owns arrays, entries and nested provider metadata without freezing callers', () => {
    const extra = { nested: { tags: ['original'] } };
    const entry = { title: 'Original', extra };
    const source = [entry];
    const result = project(source)!;
    source.push({ title: 'Another', extra });
    entry.title = 'Mutated';
    extra.nested.tags.push('mutated');
    expect(result).toEqual([
      {
        id: 'c1',
        index: 1,
        title: 'Original',
        extra: { nested: { tags: ['original'] } },
      },
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(Object.isFrozen(result[0].extra?.['nested'])).toBe(true);
    expect(Object.isFrozen(entry)).toBe(false);
    expect(Object.isFrozen(extra)).toBe(false);
  });

  it('rejects opaque and cyclic extras at the existing ownership boundary', () => {
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    for (const extra of [
      new Date(),
      { nested: new Map() },
      cycle,
      { run: () => 1 },
    ]) {
      expect(() => project([{ extra }])).toThrow(/plain data/);
      expect(Object.isFrozen(extra)).toBe(false);
    }
  });
});
