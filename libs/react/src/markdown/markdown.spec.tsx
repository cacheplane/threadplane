import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMarkdown,
  type MarkdownNode,
  type MarkdownSnapshot,
} from '@threadplane/content/markdown';
import { Markdown } from './index.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const snapshot = (content: string) =>
  createMarkdown({ generation: 'a', phase: 'complete', content }).getSnapshot();
const dispositions = {
  document: 'children',
  paragraph: 'p',
  heading: 'h1-h6',
  blockquote: 'blockquote',
  list: 'ol/ul',
  'list-item': 'li/disabled checkbox',
  'code-block': 'pre/code',
  'thematic-break': 'hr',
  text: 'text',
  emphasis: 'em',
  strong: 'strong',
  strikethrough: 'del',
  'inline-code': 'code',
  link: 'a or children',
  autolink: 'a or text',
  image: 'img or accessible fallback',
  'soft-break': 'newline',
  'hard-break': 'br',
  table: 'table/thead/tbody',
  'table-row': 'tr',
  'table-cell': 'th/td',
  'citation-reference': 'numbered marker',
  'link-reference': 'label/target or visible source form',
  'math-inline': 'delimited literal',
  'math-display': 'delimited literal',
  'html-inline': 'escaped text',
  'html-block': 'escaped text',
} satisfies Record<MarkdownNode['type'], string>;

describe('Markdown', () => {
  it('assigns every current kind a disposition and renders a null root empty', () => {
    expect(Object.keys(dispositions)).toHaveLength(27);
    expect(
      render(<Markdown snapshot={snapshot('')} />).container.textContent
    ).toBe('');
  });
  it('renders native headings, paragraphs, nested formatting, quote, lists and disabled tasks', () => {
    const view = render(
      <Markdown
        snapshot={snapshot(
          '# Heading\n\nA *soft **strong** text* and ~~gone~~.\n\n> quoted\n\n3. three\n4. four\n\n- [x] checked\n- [ ] open\n  - nested\n'
        )}
      />
    );
    expect(view.getByRole('heading', { level: 1 }).textContent).toBe('Heading');
    expect(view.container.querySelector('em strong')?.textContent).toBe(
      'strong'
    );
    expect(view.container.querySelector('del')?.textContent).toBe('gone');
    expect(view.container.querySelector('blockquote p')?.textContent).toBe(
      'quoted'
    );
    expect(view.container.querySelector('ol')?.getAttribute('start')).toBe('3');
    expect(view.container.querySelectorAll('ol > li')).toHaveLength(2);
    expect(view.container.querySelector('ul > li > ul > li')?.textContent).toBe(
      'nested'
    );
    const boxes = view.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((box) => [box.checked, box.disabled])).toEqual([
      [true, true],
      [false, true],
    ]);
  });
  it('preserves code and soft-break whitespace, tables, alignment and thematic breaks', () => {
    const view = render(
      <Markdown
        snapshot={snapshot(
          'soft\nline ` a  b `\n\n```ts\n  const x = 1;\n\n```\n\n---\n\n| left | right |\n| :--- | ---: |\n| a | b |\n'
        )}
      />
    );
    expect(view.container.querySelector('p')?.textContent).toContain(
      'soft\nline'
    );
    expect(view.container.querySelector('pre code')?.textContent).toBe(
      '  const x = 1;\n'
    );
    expect(view.container.querySelector('p code')?.textContent).toBe(' a  b ');
    expect(view.container.querySelector('hr')).not.toBeNull();
    expect(
      view.container.querySelectorAll('table > thead > tr > th')
    ).toHaveLength(2);
    const cells = [
      ...view.container.querySelectorAll<HTMLTableCellElement>(
        'table > tbody > tr > td'
      ),
    ];
    expect(
      cells.map((cell) => [cell.textContent, cell.style.textAlign])
    ).toEqual([
      ['a', 'left'],
      ['b', 'right'],
    ]);
  });
  it('uses accepted literal targets and omits blocked link/image destinations', () => {
    const view = render(
      <Markdown
        snapshot={snapshot(
          '[safe](/relative "Title") <https://example.test> [blocked](javascript:evil) ![blocked image](data:image/png;base64,AA) ![]() ![valid](/image "Image title")\n\n[blocked reference][ref]\n\n[ref]: javascript:evil\n'
        )}
      />
    );
    expect(view.getByRole('link', { name: 'safe' }).getAttribute('href')).toBe(
      '/relative'
    );
    expect(view.getByRole('link', { name: 'safe' }).getAttribute('title')).toBe(
      'Title'
    );
    expect(
      view
        .getByRole('link', { name: 'https://example.test' })
        .getAttribute('href')
    ).toBe('https://example.test');
    expect(view.queryByRole('link', { name: 'blocked' })).toBeNull();
    expect(view.queryByRole('link', { name: 'blocked reference' })).toBeNull();
    expect(view.container.textContent).toContain('blocked reference');
    expect(view.container.textContent).toContain('blocked');
    expect(view.getByRole('img', { name: 'blocked image' }).tagName).toBe(
      'SPAN'
    );
    expect(view.getByRole('img', { name: 'Image unavailable' }).tagName).toBe(
      'SPAN'
    );
    expect(view.container.querySelectorAll('img')).toHaveLength(1);
    expect(view.getByRole('img', { name: 'valid' }).getAttribute('src')).toBe(
      '/image'
    );
    expect(view.getByRole('img', { name: 'valid' }).getAttribute('title')).toBe(
      'Image title'
    );
  });
  it('retains reference forms then uses child labels when same-generation definitions arrive', () => {
    const content =
      'Stable paragraph.\n\n[**Display**][ref] [collapsed][] [shortcut]\n\n';
    const owner = createMarkdown({
      generation: 'a',
      phase: 'streaming',
      content,
    });
    const view = render(<Markdown snapshot={owner.getSnapshot()} />),
      first = view.container.querySelector('p');
    expect(view.container.textContent).toContain(
      '[**Display**][ref] [collapsed][] [shortcut]'
    );
    owner.update({
      generation: 'a',
      phase: 'complete',
      content:
        content +
        '[ref]: /full "Full title"\n[collapsed]: /collapsed\n[shortcut]: /shortcut\n',
    });
    view.rerender(<Markdown snapshot={owner.getSnapshot()} />);
    expect(view.container.querySelector('p')).toBe(first);
    expect(view.getByRole('link', { name: '**Display**' }).textContent).toBe(
      '**Display**'
    );
    expect(
      view.getByRole('link', { name: '**Display**' }).getAttribute('href')
    ).toBe('/full');
    expect(
      view.getByRole('link', { name: '**Display**' }).getAttribute('title')
    ).toBe('Full title');
    expect(
      view.getByRole('link', { name: 'collapsed' }).getAttribute('href')
    ).toBe('/collapsed');
    expect(
      view.getByRole('link', { name: 'shortcut' }).getAttribute('href')
    ).toBe('/shortcut');
  });
  it.each(['\u0000https://example.test', 'a&b', 'a&b:c'])(
    'uses quiet visible fallbacks for parser-produced destination %j',
    (url) => {
      const warn = vi.spyOn(console, 'warn');
      const error = vi.spyOn(console, 'error');
      const accepted = snapshot(`[link](${url}) ![image](${url}) [reference][ref]\n\n[ref]: ${url}\n`);
      const paragraph = accepted.root?.children[0];
      if (paragraph?.type !== 'paragraph') throw new Error('Expected paragraph');
      expect(paragraph.children.filter(node => 'url' in node).map(node => node.url)).toEqual([url, url, url]);
      expect(paragraph.children.find(node => node.type === 'link-reference')).toMatchObject({ resolved: true, url });
      const view = render(<Markdown snapshot={accepted} />);
      expect(view.container.querySelectorAll('a[href], img[src]')).toHaveLength(0);
      expect(view.container.textContent).toBe('link image reference');
      expect(view.getByRole('img', { name: 'image' }).tagName).toBe('SPAN');
      expect(view.container.innerHTML).not.toContain('unsafe:');
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    }
  );
  it.each(['./a&b', './a&b:c', '/a&b:c', '?a&b:c', '#a&b:c', 'HTTPS://example.test/a&b:c?q=a&b:c', 'safe-relative'])(
    'preserves native-compatible parser destination %j unchanged',
    (url) => {
      const warn = vi.spyOn(console, 'warn');
      const error = vi.spyOn(console, 'error');
      const view = render(<Markdown snapshot={snapshot(`[link](${url}) ![image](${url}) [reference][ref]\n\n[ref]: ${url}\n`)} />);
      expect(Array.from(view.container.querySelectorAll('a'), node => node.getAttribute('href'))).toEqual([url, url]);
      expect(view.getByRole('img', { name: 'image' }).getAttribute('src')).toBe(url);
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    }
  );
  it('omits a space-prefixed scheme preserved by a resolved reference definition', () => {
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    const accepted = snapshot('[reference][ref]\n\n[ref]: < https://example.test>\n');
    const paragraph = accepted.root?.children[0];
    if (paragraph?.type !== 'paragraph') throw new Error('Expected paragraph');
    expect(paragraph.children[0]).toMatchObject({ type: 'link-reference', resolved: true, url: ' https://example.test' });
    const view = render(<Markdown snapshot={accepted} />);
    expect(view.container.querySelector('a')).toBeNull();
    expect(view.container.textContent).toBe('reference');
    expect(view.container.innerHTML).not.toContain('unsafe:');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
  const nestedLinks = [
    { source: '[inner](/inner)', text: 'inner', href: '/inner' },
    {
      source: '<https://example.test>',
      text: 'https://example.test',
      href: 'https://example.test',
    },
    { source: '[inner][ref]', text: 'inner', href: '/inner' },
  ];
  it.each(nestedLinks)(
    'preserves $source as label text inside an accepted anchor',
    ({ source, text }) => {
      const error = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const view = render(
        <Markdown
          snapshot={snapshot(`[outer ${source}](/outer)\n\n[ref]: /inner\n`)}
        />
      );
      expect(view.container.querySelector('a a')).toBeNull();
      expect(view.getAllByRole('link')).toHaveLength(1);
      expect(view.getByRole('link').getAttribute('href')).toBe('/outer');
      expect(view.getByRole('link').textContent).toBe(`outer ${text}`);
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    }
  );
  it.each(nestedLinks)(
    'keeps a safe $source active when its outer destination is blocked',
    ({ source, text, href }) => {
      const error = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const view = render(
        <Markdown
          snapshot={snapshot(
            `[outer *${source}*](javascript:evil)\n\n[ref]: /inner\n`
          )}
        />
      );
      expect(view.container.querySelector('a a')).toBeNull();
      expect(view.getAllByRole('link')).toHaveLength(1);
      expect(view.getByRole('link').getAttribute('href')).toBe(href);
      expect(view.getByRole('link').textContent).toBe(text);
      expect(view.container.querySelector('em > a')).toBe(
        view.getByRole('link')
      );
      expect(view.container.textContent).toBe(`outer ${text}`);
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    }
  );
  it('retains the accepted-anchor context through formatting and blocked nested links', () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const view = render(
      <Markdown
        snapshot={snapshot(
          '[outer *[middle [inner](/inner)](javascript:evil)*](/outer)'
        )}
      />
    );
    expect(view.container.querySelector('a a')).toBeNull();
    expect(view.getAllByRole('link')).toHaveLength(1);
    expect(view.getByRole('link').getAttribute('href')).toBe('/outer');
    expect(view.getByRole('link').textContent).toBe('outer middle inner');
    expect(view.container.querySelector('a > em')?.textContent).toBe(
      'middle inner'
    );
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
  it('escapes HTML and presents explicit math/citation fallbacks', () => {
    const view = render(
      <Markdown
        snapshot={snapshot(
          '<div>literal</div>\n\nA <span>inline</span> $x$ and \\(y\\), citation [^source].\n\n$$\nx+y\n$$\n\n[^source]: Source\n'
        )}
      />
    );
    expect(view.container.textContent).toContain('<div>literal</div>');
    expect(view.container.textContent).toContain('<span>inline</span>');
    expect(view.container.querySelector('pre')?.children).toHaveLength(0);
    expect(view.container.querySelector('p')?.innerHTML).toContain(
      '&lt;span&gt;inline&lt;/span&gt;'
    );
    expect(view.container.textContent).toContain('$x$');
    expect(view.container.textContent).toContain('\\(y\\)');
    expect(view.container.textContent).toContain('$$\nx+y\n$$');
    expect(view.getByLabelText('Citation 1').textContent).toBe('[1]');
  });
  it('uses definition numbering and preserves unresolved citation markers', () => {
    const view = render(
      <Markdown
        snapshot={snapshot(
          '[^first]: First\n\nBefore [^second], again [^second], then [^first] and [^missing].\n\n[^second]: Second\n'
        )}
      />
    );
    expect(
      view.getAllByLabelText('Citation 2').map((node) => node.textContent)
    ).toEqual(['[2]', '[2]']);
    expect(view.getByLabelText('Citation 1').textContent).toBe('[1]');
    expect(view.getByLabelText('Unresolved citation missing').textContent).toBe(
      '[^missing]'
    );
  });
  it('keeps unchanged DOM through equal renders, appends and finish but replaces generations and incompatible kinds', () => {
    const owner = createMarkdown({
      generation: 'a',
      phase: 'streaming',
      content: 'Stable.\n\n- item\n\n| a |\n| --- |\n| b |\n\n',
    });
    const view = render(<Markdown snapshot={owner.getSnapshot()} />);
    const nodes = ['p', 'ul', 'table'].map((selector) =>
      view.container.querySelector(selector)
    );
    expect(nodes.every(Boolean)).toBe(true);
    view.rerender(<Markdown snapshot={owner.getSnapshot()} />);
    owner.update({
      generation: 'a',
      phase: 'streaming',
      content: owner.getSnapshot().document.content + 'new',
    });
    view.rerender(<Markdown snapshot={owner.getSnapshot()} />);
    ['p', 'ul', 'table'].forEach((selector, index) => {
      expect(view.container.querySelector(selector)).toBe(nodes[index]);
    });
    owner.update({ ...owner.getSnapshot().document, phase: 'complete' });
    view.rerender(<Markdown snapshot={owner.getSnapshot()} />);
    expect(view.container.querySelector('table')).toBe(nodes[2]);
    owner.update({ generation: 'b', phase: 'streaming', content: '-' });
    view.rerender(<Markdown snapshot={owner.getSnapshot()} />);
    expect(nodes.every((node) => !node?.isConnected)).toBe(true);
    const paragraph = view.container.querySelector('p');
    owner.update({ generation: 'b', phase: 'streaming', content: '- item' });
    view.rerender(<Markdown snapshot={owner.getSnapshot()} />);
    expect(paragraph?.isConnected).toBe(false);
    expect(view.container.querySelector('ul > li')).not.toBeNull();
  });
  it('isolates failed image state by destination and generation, ignoring removed image errors', () => {
    const owner = createMarkdown(
      { generation: 'a', phase: 'streaming', content: '![alt](/one)' },
      { violationPolicy: 'rebuild' }
    );
    const view = render(<Markdown snapshot={owner.getSnapshot()} />);
    const old = view.getByRole('img', { name: 'alt' });
    fireEvent.error(old);
    expect(view.getByRole('img', { name: 'alt' }).tagName).toBe('SPAN');
    owner.update({
      generation: 'a',
      phase: 'complete',
      content: '![alt](/two)',
    });
    view.rerender(<Markdown snapshot={owner.getSnapshot()} />);
    const replacement = view.getByRole('img', { name: 'alt' });
    expect(replacement.tagName).toBe('IMG');
    expect(replacement.getAttribute('src')).toBe('/two');
    fireEvent.error(old);
    expect(view.getByRole('img', { name: 'alt' })).toBe(replacement);
    fireEvent.error(replacement);
    owner.update({
      generation: 'b',
      phase: 'complete',
      content: '![alt](/two)',
    });
    view.rerender(<Markdown snapshot={owner.getSnapshot()} />);
    expect(view.getByRole('img', { name: 'alt' }).tagName).toBe('IMG');
    fireEvent.error(replacement);
    expect(view.getByRole('img', { name: 'alt' }).tagName).toBe('IMG');
  });
  it('preserves accepted input, DOM and image failure through unrelated parent renders and equal snapshots', () => {
    const owner = createMarkdown({
      generation: 'a',
      phase: 'complete',
      content: 'Stable ![alt](/image).',
    });
    const accepted = owner.getSnapshot();
    function Parent({
      count,
      input,
    }: {
      count: number;
      input: MarkdownSnapshot;
    }) {
      return (
        <section>
          <span>{count}</span>
          <Markdown snapshot={input} />
        </section>
      );
    }
    const view = render(<Parent count={0} input={accepted} />);
    const paragraph = view.container.querySelector('p');
    fireEvent.error(view.getByRole('img', { name: 'alt' }));
    const fallback = view.getByRole('img', { name: 'alt' });
    view.rerender(<Parent count={1} input={{ ...accepted }} />);
    expect(view.container.querySelector('p')).toBe(paragraph);
    expect(view.getByRole('img', { name: 'alt' })).toBe(fallback);
    expect(fallback.tagName).toBe('SPAN');
    expect(owner.getSnapshot()).toBe(accepted);
    expect(accepted.document.content).toBe('Stable ![alt](/image).');
    expect(Object.isFrozen(accepted.root)).toBe(true);
  });
  it('renders a supplementary hard-break node not produced by the current parser examples', () => {
    const original = snapshot('a'),
      root = original.root;
    if (!root) throw new Error('Expected real document');
    const hard: MarkdownNode = {
      type: 'hard-break',
      id: 99,
      status: 'complete',
      parent: null,
      index: 0,
    };
    const supplemented: MarkdownSnapshot = {
      ...original,
      root: {
        ...root,
        children: [
          {
            type: 'paragraph',
            id: 98,
            parent: null,
            status: 'complete',
            index: 0,
            children: [hard],
          },
        ],
      },
    };
    expect(
      render(<Markdown snapshot={supplemented} />).container.querySelector(
        'p > br'
      )
    ).not.toBeNull();
  });
});
