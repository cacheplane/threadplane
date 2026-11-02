import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createMarkdown } from '@threadplane/content/markdown';
import type { Citation } from '@threadplane/core';
import { Markdown } from './markdown.js';

afterEach(cleanup);
const snapshot = (content: string, generation = 'a') =>
  createMarkdown({ generation, phase: 'complete', content }).getSnapshot();
const source: Citation = {
  id: '__proto__',
  index: 7,
  title: '<b>Source</b>',
  url: '/supplied',
};

describe('inline citations', () => {
  it('uses exact supplied IDs before definitions and treats source titles literally', () => {
    const view = render(
      <Markdown
        snapshot={snapshot(
          'See [^__proto__], [^7] and [^missing].\n\n[^__proto__]: Wrong [link](/definition)\n'
        )}
        citations={[source]}
      />
    );
    const link = view.getByRole('link', {
      name: 'Citation 7: <b>Source</b> (opens in new tab)',
    });
    expect(link.textContent).toBe('[7]');
    expect(link.getAttribute('href')).toBe('/supplied');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(view.container.querySelector('b')).toBeNull();
    expect(view.getByLabelText('Unresolved citation 7').textContent).toBe(
      '[^7]'
    );
    expect(view.getByLabelText('Unresolved citation missing').textContent).toBe(
      '[^missing]'
    );
  });
  it('derives definition numbering, literal titles and immediate link or autolink targets', () => {
    const view = render(
      <Markdown
        snapshot={snapshot(
          '[^first]: First\n\nBefore [^second], [^first] and [^auto].\n\n[^second]: Literal **title** [read](/definition) ignored\n\n[^auto]: Auto <https://example.test>\n'
        )}
      />
    );
    expect(
      view
        .getByRole('link', {
          name: 'Citation 2: Literal title (opens in new tab)',
        })
        .getAttribute('href')
    ).toBe('/definition');
    expect(
      view
        .getByRole('link', { name: 'Citation 3: Auto (opens in new tab)' })
        .getAttribute('href')
    ).toBe('https://example.test');
    expect(view.getByLabelText('Citation 1: First').textContent).toBe('[1]');
  });
  it.each([
    undefined,
    'javascript:evil',
    'data:text/html,evil',
    '\u0000https://example.test',
  ])('keeps authoritative metadata with target %j noninteractive', (url) => {
    const view = render(
      <Markdown
        snapshot={snapshot(
          '[^__proto__]\n\n[^__proto__]: Safe [link](/safe)\n'
        )}
        citations={[{ ...source, url }]}
      />
    );
    expect(view.getByLabelText('Citation 7: <b>Source</b>').textContent).toBe(
      '[7]'
    );
    expect(view.container.querySelector('a')).toBeNull();
  });
  it('rejects duplicate supplied IDs', () => {
    expect(() =>
      render(<Markdown snapshot={snapshot('')} citations={[source, source]} />)
    ).toThrow(/Duplicate citation IDs/);
  });
  it('updates or removes metadata synchronously and isolates messages and generations', () => {
    const accepted = snapshot('[^__proto__]');
    const view = render(
      <>
        <Markdown snapshot={accepted} citations={[source]} />
        <Markdown snapshot={accepted} />
      </>
    );
    expect(view.getAllByRole('link')).toHaveLength(1);
    expect(view.getByLabelText('Unresolved citation __proto__')).toBeTruthy();
    view.rerender(
      <Markdown
        snapshot={accepted}
        citations={[{ ...source, url: '/replacement' }]}
      />
    );
    expect(view.getByRole('link').getAttribute('href')).toBe('/replacement');
    view.rerender(<Markdown snapshot={accepted} />);
    expect(view.queryByRole('link')).toBeNull();
    expect(view.getByLabelText('Unresolved citation __proto__')).toBeTruthy();
    view.rerender(
      <Markdown
        snapshot={snapshot('[^__proto__]', 'b')}
        citations={[{ ...source, url: '/new-generation' }]}
      />
    );
    expect(view.getByRole('link').getAttribute('href')).toBe('/new-generation');
  });
  it.each(['link', 'link-reference'] as const)(
    'contains citation markers inside existing %s anchors through emphasis',
    (type) => {
      const accepted = snapshot('[outer *[^__proto__]*](/outer)');
      const root = accepted.root;
      if (!root) throw new Error('Expected document');
      // The current parser leaves reference labels literal. Supplement that branch
      // with the same real parsed children to verify accepted reference-node context.
      const input =
        type === 'link'
          ? accepted
          : {
              ...accepted,
              root: {
                ...root,
                children: root.children.map((node) =>
                  node.type === 'paragraph'
                    ? {
                        ...node,
                        children: node.children.map((child) =>
                          child.type === 'link'
                            ? {
                                ...child,
                                type,
                                resolved: true as const,
                                label: 'ref',
                                refId: 'ref',
                                form: 'full' as const,
                              }
                            : child
                        ),
                      }
                    : node
                ),
              },
            };
      const view = render(<Markdown snapshot={input} citations={[source]} />);
      expect(view.getAllByRole('link')).toHaveLength(1);
      expect(view.getByRole('link').getAttribute('href')).toBe('/outer');
      expect(
        view.container.querySelector('a em sup')?.getAttribute('aria-label')
      ).toBe('Citation 7: <b>Source</b>');
      expect(view.container.querySelector('a a')).toBeNull();
    }
  );
  it('threads metadata through header and body table branches', () => {
    const view = render(
      <Markdown
        snapshot={snapshot('| [^__proto__] |\n| --- |\n| [^__proto__] |\n')}
        citations={[source]}
      />
    );
    expect(view.container.querySelector('th a')?.getAttribute('href')).toBe(
      '/supplied'
    );
    expect(view.container.querySelector('td a')?.getAttribute('href')).toBe(
      '/supplied'
    );
  });
});
