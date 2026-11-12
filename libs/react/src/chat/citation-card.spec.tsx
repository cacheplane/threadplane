import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Citation } from '@threadplane/core';
import {
  citationSourceVisual,
  formatPublished,
} from '@threadplane/content/messages';
import { CitationCard, Citations } from './index';

afterEach(cleanup);
const base: Citation = { id: 'source', index: 7 };

describe('CitationCard', () => {
  it.each(['file', 'app', 'memory', 'generic', 'custom_type', 'unknown'])(
    'uses a finite decorative local icon for %s and never the borrowed provider image',
    (sourceType) => {
      const citation = Object.freeze({
        ...base,
        sourceType,
        iconUrl: 'https://images.invalid/icon',
      });
      const view = render(
        <CitationCard citation={citation} className="extra" />
      );
      const visual = view.container.querySelector('.tp-citation-card__visual');
      const icon = ['file', 'app', 'memory', 'generic'].includes(sourceType)
        ? sourceType
        : 'generic';
      expect(
        visual?.classList.contains(`tp-citation-card__visual--${icon}`)
      ).toBe(true);
      expect(visual?.getAttribute('aria-hidden')).toBe('true');
      expect(visual?.querySelector('svg')).not.toBeNull();
      expect(view.container.querySelector('img, image')).toBeNull();
      expect(
        view.container.firstElementChild?.classList.contains('extra')
      ).toBe(true);
      expect(citation.iconUrl).toBe('https://images.invalid/icon');
      expect(
        view.container.querySelector('.tp-citations__type')?.textContent ?? null
      ).toBe(
        sourceType === 'unknown'
          ? null
          : sourceType === 'custom_type'
          ? 'Custom type'
          : sourceType[0].toUpperCase() + sourceType.slice(1)
      );
    }
  );

  it('renders a deterministic web monogram and normalized badge with exact shared metadata', () => {
    const citation = Object.freeze({
      ...base,
      sourceType: ' WEB ',
      url: 'https://www.example.com/path',
      title: 'Title',
      snippet: 'Snippet',
      publishedAt: '2024-04-15T12:00:00Z',
      iconUrl: '/never-fetch',
    });
    const view = render(<CitationCard citation={citation} />);
    const expected = citationSourceVisual({ ...citation, iconUrl: undefined });
    if (expected.kind !== 'monogram') throw new Error('Expected web monogram');
    const visual = view.container.querySelector<HTMLElement>(
      '.tp-citation-card__visual'
    );
    expect(visual?.textContent).toBe(expected.monogram);
    const expectedStyle = document.createElement('span').style;
    expectedStyle.backgroundColor = expected.color;
    expect(visual?.style.backgroundColor).toBe(expectedStyle.backgroundColor);
    const color = visual?.style.backgroundColor;
    expect(
      view.container.querySelector('.tp-citations__index')?.textContent
    ).toBe('7');
    expect(
      view.container.querySelector('.tp-citations__type')?.textContent
    ).toBe('Web');
    expect(
      view.container.querySelector('.tp-citation-card__domain')?.textContent
    ).toBe('example.com');
    expect(
      view.container.querySelector('.tp-citation-card__published')?.textContent
    ).toBe(formatPublished(citation.publishedAt));
    const link = view.getByRole('link', { name: 'Title' });
    expect(link.getAttribute('href')).toBe(citation.url);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    view.rerender(<CitationCard citation={{ ...citation }} />);
    expect(
      view.container.querySelector<HTMLElement>('.tp-citation-card__visual')
        ?.style.backgroundColor
    ).toBe(color);
    expect(view.container.querySelector('img, image')).toBeNull();
  });

  it.each([
    ['javascript:alert(1)', false, null],
    ['ftp://blocked.invalid/path', false, 'blocked.invalid'],
    ['data:text/html,test', false, null],
    ['/relative', true, null],
    ['mailto:test@example.com', true, null],
    ['', false, null],
  ] as const)(
    'applies link policy separately from host derivation for %s',
    (url, safe, domain) => {
      const view = render(
        <CitationCard
          citation={{
            ...base,
            title: 'Title',
            url,
            publishedAt: 'invalid date',
          }}
        />
      );
      expect(view.queryByRole('link')?.getAttribute('href') ?? null).toBe(
        safe ? url : null
      );
      expect(
        view.container.querySelector('.tp-citation-card__domain')
          ?.textContent ?? null
      ).toBe(domain);
      expect(
        view.container.querySelector('.tp-citation-card__published')
      ).toBeNull();
    }
  );

  it('preserves absent versus empty metadata and literal hostile strings', () => {
    const view = render(<CitationCard citation={base} />);
    expect(
      view.container.querySelector('.tp-citations__title')?.textContent
    ).toBe('Source 7');
    expect(view.container.querySelector('.tp-citations__snippet')).toBeNull();
    expect(view.container.querySelector('.tp-citations__type')).toBeNull();
    view.rerender(
      <CitationCard
        citation={{
          ...base,
          url: '/fallback',
          title: '',
          snippet: '',
          sourceType: '',
        }}
      />
    );
    expect(
      view.container.querySelector('.tp-citations__title')?.textContent
    ).toBe('');
    expect(
      view.container.querySelector('.tp-citations__snippet')?.textContent
    ).toBe('');
    expect(
      view.container.querySelector('.tp-citations__type')?.textContent
    ).toBe('Web');
    view.rerender(<CitationCard citation={{ ...base, url: '/fallback' }} />);
    expect(view.getByRole('link').textContent).toBe('/fallback');
    view.rerender(
      <CitationCard
        citation={{
          ...base,
          title: '<b>Title</b>',
          snippet: '<img src=x>\n**literal**',
          sourceType: '<script>literal()</script>',
        }}
      />
    );
    expect(
      view.container.querySelector('.tp-citations__title')?.textContent
    ).toBe('<b>Title</b>');
    expect(
      view.container.querySelector('.tp-citations__snippet')?.textContent
    ).toBe('<img src=x>\n**literal**');
    expect(
      view.container.querySelector('.tp-citations__type')?.textContent
    ).toBe('<script>literal()</script>');
    expect(view.container.querySelector('img,image,b,script')).toBeNull();
    expect(
      view.container.querySelector('.tp-citation-card__visual')?.className
    ).toBe('tp-citation-card__visual tp-citation-card__visual--generic');
  });

  it('refreshes corrected default card metadata and retains exact ID keyed list items through reorder', () => {
    const original = Object.freeze({
      ...base,
      title: 'Original',
      url: '/first',
    });
    const other = { id: 'other', index: 2, title: 'Other' };
    const view = render(<Citations citations={[original, other]} />);
    const item = view.getAllByRole('listitem')[0];
    expect(item.querySelector('.tp-citation-card')).not.toBeNull();
    view.rerender(
      <Citations
        citations={[
          other,
          {
            ...original,
            title: 'Corrected',
            url: '/next',
            sourceType: 'MEMORY',
            snippet: 'New snippet',
          },
        ]}
      />
    );
    expect(view.getAllByRole('listitem')[1]).toBe(item);
    expect(
      view.getByRole('link', { name: 'Corrected' }).getAttribute('href')
    ).toBe('/next');
    expect(item.querySelector('.tp-citations__type')?.textContent).toBe(
      'Memory'
    );
    expect(item.querySelector('.tp-citations__snippet')?.textContent).toBe(
      'New snippet'
    );
    expect(
      item.querySelector('.tp-citation-card__visual--memory')
    ).not.toBeNull();
    expect(original.title).toBe('Original');
  });
});
