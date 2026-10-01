import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Citation } from '@threadplane/core';
import { Citations } from './index';

afterEach(cleanup);
describe('Citations', () => {
  it('hides empty sources and borrows literal metadata without fetching icons', () => {
    const view = render(<Citations citations={[]} />);
    expect(view.container.childElementCount).toBe(0);
    const citations = Object.freeze([
      Object.freeze({
        id: '__proto__',
        index: 7,
        title: '<b>Source</b>',
        snippet: '<img src=x>\nLine',
        sourceType: 'Authored',
        iconUrl: 'https://images.invalid/icon',
      }),
    ]);
    view.rerender(
      <Citations citations={citations} label="Evidence" className="extra" />
    );
    const region = view.getByRole('region', { name: 'Evidence' });
    expect(region.className).toContain('extra');
    expect(view.getByRole('heading').textContent).toBe('Evidence');
    expect(region.textContent).toContain('[7]');
    expect(region.textContent).toContain('<b>Source</b>');
    expect(region.textContent).toContain('<img src=x>\nLine');
    expect(region.querySelector('img, script, b')).toBeNull();
    expect(view.queryByRole('link')).toBeNull();
    expect(citations[0].title).toBe('<b>Source</b>');
  });
  it('uses the existing destination policy and preserves absent versus empty text', () => {
    const urls = [
      'https://example.com/a',
      '/relative',
      'mailto:test@example.com',
      'javascript:alert(1)',
      'data:text/html,test',
      'java\nscript:alert(1)',
      '',
    ];
    const citations: readonly Citation[] = urls.map((url, index) => ({
      id: String(index),
      index,
      url,
    }));
    const view = render(
      <Citations
        citations={[
          ...citations,
          { id: 'empty', index: 10, title: '', snippet: '', sourceType: '' },
          { id: 'missing', index: 11 },
        ]}
      />
    );
    expect(
      view.getAllByRole('link').map((link) => link.getAttribute('href'))
    ).toEqual(urls.slice(0, 3));
    for (const link of view.getAllByRole('link')) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(view.container.textContent).toContain('javascript:alert(1)');
    const items = view.getAllByRole('listitem');
    expect(items[7].querySelector('.tp-citations__title')?.textContent).toBe(
      ''
    );
    expect(items[7].querySelector('.tp-citations__snippet')?.textContent).toBe(
      ''
    );
    expect(items[7].querySelector('.tp-citations__type')?.textContent).toBe('');
    expect(items[8].querySelector('.tp-citations__title')?.textContent).toBe(
      'Source 11'
    );
  });
  it('preserves keyed items across update/reorder and rejects duplicate IDs', () => {
    const view = render(
      <Citations
        citations={[
          { id: '', index: 2, title: 'A' },
          { id: 'b', index: 1, title: 'B' },
        ]}
      />
    );
    const first = view.getAllByRole('listitem')[0];
    view.rerender(
      <Citations
        citations={[
          { id: 'b', index: 1, title: 'B' },
          { id: '', index: 2, title: 'Changed' },
        ]}
      />
    );
    expect(view.getAllByRole('listitem')[1]).toBe(first);
    expect(first.textContent).toContain('Changed');
    expect(() =>
      view.rerender(
        <Citations
          citations={[
            { id: 'same', index: 1 },
            { id: 'same', index: 2 },
          ]}
        />
      )
    ).toThrow(/duplicate citation/i);
  });
});
