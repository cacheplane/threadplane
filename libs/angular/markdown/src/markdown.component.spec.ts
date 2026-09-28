import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMarkdown,
  type MarkdownNode,
  type MarkdownSnapshot,
} from '@threadplane/content/markdown';
import { MarkdownComponent } from './public-api';

afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});
const snapshot = (content: string) =>
  createMarkdown({ generation: 'a', phase: 'complete', content }).getSnapshot();
function mount(input: MarkdownSnapshot) {
  const fixture = TestBed.createComponent(MarkdownComponent);
  const update = (value: MarkdownSnapshot) => {
    fixture.componentRef.setInput('snapshot', value);
    fixture.detectChanges();
  };
  update(input);
  return { fixture, root: fixture.nativeElement as HTMLElement, update };
}
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
  link: 'a/children',
  autolink: 'a/text',
  image: 'img/accessible fallback',
  'soft-break': 'newline',
  'hard-break': 'br',
  table: 'table/thead/tbody',
  'table-row': 'tr',
  'table-cell': 'th/td',
  'citation-reference': 'accessible marker',
  'link-reference': 'a/source form',
  'math-inline': 'delimited text',
  'math-display': 'delimited text',
  'html-inline': 'escaped text',
  'html-block': 'escaped text',
} satisfies Record<MarkdownNode['type'], string>;

describe('MarkdownComponent', () => {
  it('preserves native paragraph and preformatted whitespace with long-token wrapping', () => {
    const { root } = mount(
      snapshot('Space   test line\nSecond soft line\n\n```\nlongtoken\n```')
    );
    expect(getComputedStyle(root).whiteSpace).toBe('pre-wrap');
    expect(getComputedStyle(root).overflowWrap).toBe('anywhere');
    const pre = root.querySelector('pre');
    if (!pre) throw new Error('Expected preformatted block');
    expect(getComputedStyle(pre).whiteSpace).toBe('pre-wrap');
  });
  it('uses raw display math delimiters without adding lines to bracket math', () => {
    const { root } = mount(snapshot('\\[\nx-y\n\\]\n\n$$\nx+y\n$$'));
    expect(
      Array.from(root.querySelectorAll('pre')).map((node) => node.textContent)
    ).toEqual(['\\[x-y\\]', '$$\nx+y\n$$']);
  });
  it('covers all 27 dispositions and renders a null root empty', () => {
    expect(Object.keys(dispositions)).toHaveLength(27);
    expect(
      mount({
        document: { generation: 'a', phase: 'complete', content: '' },
        root: null,
      }).root.textContent
    ).toBe('');
  });
  it('renders native formatting, all heading levels, lists, tasks and quotes', () => {
    const { root } = mount(
      snapshot(
        '# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n\nA *soft **strong** text* ~~gone~~.\n\n> quote\n\n3. three\n4. four\n\n- [x] checked\n- [ ] open\n  - nested\n'
      )
    );
    expect(
      Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(
        (n) => n.textContent
      )
    ).toEqual(['One', 'Two', 'Three', 'Four', 'Five', 'Six']);
    expect(root.querySelector('em > strong')?.textContent).toBe('strong');
    expect(root.querySelector('del')?.textContent).toBe('gone');
    expect(root.querySelector('blockquote > p')?.textContent).toBe('quote');
    expect(root.querySelector('ol')?.getAttribute('start')).toBe('3');
    expect(root.querySelectorAll('ol > li')).toHaveLength(2);
    expect(root.querySelector('ul > li > ul > li')?.textContent).toBe('nested');
    expect(
      Array.from(root.querySelectorAll('input')).map((n) => [
        n.checked,
        n.disabled,
        n.getAttribute('aria-label'),
      ])
    ).toEqual([
      [true, true, 'Completed task'],
      [false, true, 'Incomplete task'],
    ]);
  });
  it('preserves code/soft break whitespace and emits direct valid table structure', () => {
    const { root } = mount(
      snapshot(
        'soft\nline ` a  b `\n\n```ts\n  const x = 1;\n\n```\n\n---\n\n| left | right | center |\n| :--- | ---: | :---: |\n| a | b | c |\n'
      )
    );
    expect(root.querySelector('p')?.textContent).toContain('soft\nline');
    expect(root.querySelector('p code')?.textContent).toBe(' a  b ');
    const inlineCode = root.querySelector('p code');
    if (!inlineCode) throw new Error('Expected inline code');
    expect(getComputedStyle(inlineCode).whiteSpace).toBe('pre-wrap');
    expect(root.querySelector('pre > code')?.textContent).toBe(
      '  const x = 1;\n'
    );
    expect(root.querySelector('hr')).not.toBeNull();
    expect(root.querySelectorAll('table > thead > tr > th')).toHaveLength(3);
    expect(
      Array.from(
        root.querySelectorAll<HTMLTableCellElement>('table > tbody > tr > td')
      ).map((n) => [n.textContent, n.style.textAlign])
    ).toEqual([
      ['a', 'left'],
      ['b', 'right'],
      ['c', 'center'],
    ]);
    expect(
      Array.from(root.querySelector('table')?.children ?? []).map(
        (n) => n.tagName
      )
    ).toEqual(['THEAD', 'TBODY']);
  });
  it('escapes HTML and displays delimited math and numbered citation fallback', () => {
    const { root } = mount(
      snapshot(
        '<div>literal</div>\n\nA <span>inline</span> $x$ and \\(y\\), [^source].\n\n$$\nx+y\n$$\n\n[^source]: Source\n'
      )
    );
    expect(root.textContent).toContain('<div>literal</div>');
    expect(root.textContent).toContain('<span>inline</span>');
    expect(root.querySelector('p')?.innerHTML).toContain('&lt;span&gt;');
    expect(root.querySelector('p')?.innerHTML).toContain('&lt;/span&gt;');
    expect(root.querySelector('p span')).toBeNull();
    expect(root.textContent).toContain('$x$');
    expect(root.textContent).toContain('\\(y\\)');
    expect(root.textContent).toContain('$$\nx+y\n$$');
    expect(root.querySelector('[aria-label="Citation 1"]')?.textContent).toBe(
      '[1]'
    );
  });
  it('numbers citations from definitions and retains missing markers', () => {
    const { root } = mount(
      snapshot(
        '[^first]: First\n\nBefore [^second], again [^second], [^first], [^missing].\n\n[^second]: Second\n'
      )
    );
    expect(
      Array.from(root.querySelectorAll('[aria-label="Citation 2"]')).map(
        (n) => n.textContent
      )
    ).toEqual(['[2]', '[2]']);
    expect(root.querySelector('[aria-label="Citation 1"]')?.textContent).toBe(
      '[1]'
    );
    expect(
      root.querySelector('[aria-label="Unresolved citation missing"]')
        ?.textContent
    ).toBe('[^missing]');
  });
  it('accepts safe destinations and leaves blocked links/images visible without unsafe DOM targets', () => {
    const { root } = mount(
      snapshot(
        '[safe](/relative "Title") <https://example.test> [blocked](javascript:evil) ![blocked image](data:image/png;base64,AA) ![]() ![valid](/image "Image title")\n\n[blocked reference][ref]\n\n[ref]: javascript:evil\n'
      )
    );
    expect(
      Array.from(root.querySelectorAll('a')).map((n) => n.getAttribute('href'))
    ).toEqual(['/relative', 'https://example.test']);
    expect(root.querySelector('a')?.title).toBe('Title');
    expect(root.textContent).toContain('blocked reference');
    expect(
      root.querySelector('[role="img"][aria-label="blocked image"]')
        ?.textContent
    ).toBe('blocked image');
    expect(
      root.querySelector('[aria-label="Image unavailable"]')
    ).not.toBeNull();
    expect(root.querySelectorAll('img')).toHaveLength(1);
    expect(root.querySelector('img')?.getAttribute('src')).toBe('/image');
    expect(root.querySelector('img')?.title).toBe('Image title');
    expect(root.innerHTML).not.toContain('unsafe:');
  });
  it('retains original case and spacing in an unresolved full reference label', () => {
    const accepted = snapshot('[Display][MiXeD  Label]');
    const paragraph = accepted.root?.children[0];
    if (paragraph?.type !== 'paragraph') throw new Error('Expected paragraph');
    const reference = paragraph.children[0];
    if (reference.type !== 'link-reference')
      throw new Error('Expected reference');
    expect(reference.refId).toBe('mixed label');
    expect(reference.label).toBe('MiXeD  Label');
    expect(mount(accepted).root.textContent).toBe('[Display][MiXeD  Label]');
  });
  it.each(['\u0000https://example.test', 'a&b', 'a&b:c'])(
    'uses quiet visible fallbacks for parser-produced destination %j',
    (url) => {
      const warn = vi.spyOn(console, 'warn');
      const error = vi.spyOn(console, 'error');
      const accepted = snapshot(
        `[link](${url}) ![image](${url}) [reference][ref]\n\n[ref]: ${url}\n`
      );
      const paragraph = accepted.root?.children[0];
      if (paragraph?.type !== 'paragraph')
        throw new Error('Expected paragraph');
      expect(
        paragraph.children
          .filter((node) => 'url' in node)
          .map((node) => node.url)
      ).toEqual([url, url, url]);
      expect(
        paragraph.children.find((node) => node.type === 'link-reference')
      ).toMatchObject({ resolved: true, url });
      const { root } = mount(accepted);
      expect(root.querySelectorAll('a[href], img[src]')).toHaveLength(0);
      expect(root.textContent).toBe('link image reference');
      expect(
        root.querySelector('[role="img"][aria-label="image"]')?.tagName
      ).toBe('SPAN');
      expect(root.innerHTML).not.toContain('unsafe:');
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    }
  );
  it.each([
    './a&b',
    './a&b:c',
    '/a&b:c',
    '?a&b:c',
    '#a&b:c',
    'HTTPS://example.test/a&b:c?q=a&b:c',
    'safe-relative',
  ])('preserves native-compatible parser destination %j unchanged', (url) => {
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    const { root } = mount(
      snapshot(
        `[link](${url}) ![image](${url}) [reference][ref]\n\n[ref]: ${url}\n`
      )
    );
    expect(
      Array.from(root.querySelectorAll('a'), (node) =>
        node.getAttribute('href')
      )
    ).toEqual([url, url]);
    expect(root.querySelector('img')?.getAttribute('src')).toBe(url);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
  it('omits a space-prefixed scheme preserved by a resolved reference definition', () => {
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    const accepted = snapshot(
      '[reference][ref]\n\n[ref]: < https://example.test>\n'
    );
    const paragraph = accepted.root?.children[0];
    if (paragraph?.type !== 'paragraph') throw new Error('Expected paragraph');
    expect(paragraph.children[0]).toMatchObject({
      type: 'link-reference',
      resolved: true,
      url: ' https://example.test',
    });
    const { root } = mount(accepted);
    expect(root.querySelector('a')).toBeNull();
    expect(root.textContent).toBe('reference');
    expect(root.innerHTML).not.toContain('unsafe:');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
  it('resolves references added later without replacing unrelated paragraphs or parsing label text again', () => {
    const content =
      'Stable.\n\n[**Display**][ref] [collapsed][] [shortcut]\n\n';
    const owner = createMarkdown({
      generation: 'a',
      phase: 'streaming',
      content,
    });
    const { root, update } = mount(owner.getSnapshot());
    const stable = root.querySelector('p');
    expect(root.textContent).toContain(
      '[**Display**][ref] [collapsed][] [shortcut]'
    );
    owner.update({
      generation: 'a',
      phase: 'complete',
      content:
        content +
        '[ref]: /full "Full title"\n[collapsed]: /collapsed\n[shortcut]: /shortcut\n',
    });
    update(owner.getSnapshot());
    expect(root.querySelector('p')).toBe(stable);
    expect(
      Array.from(root.querySelectorAll('a')).map((n) => [
        n.textContent,
        n.getAttribute('href'),
      ])
    ).toEqual([
      ['**Display**', '/full'],
      ['collapsed', '/collapsed'],
      ['shortcut', '/shortcut'],
    ]);
    expect(root.querySelector('a')?.title).toBe('Full title');
    expect(root.querySelector('a strong')).toBeNull();
  });
  const nested = [
    ['[inner](/inner)', 'inner', '/inner'],
    ['<https://example.test>', 'https://example.test', 'https://example.test'],
    ['[inner][ref]', 'inner', '/inner'],
  ];
  it.each(nested)(
    'renders %s as text inside an accepted anchor',
    (source, label) => {
      const { root } = mount(
        snapshot(`[outer ${source}](/outer)\n\n[ref]: /inner\n`)
      );
      expect(root.querySelector('a a')).toBeNull();
      expect(root.querySelectorAll('a')).toHaveLength(1);
      expect(root.querySelector('a')?.textContent).toBe(`outer ${label}`);
      expect(root.querySelector('a')?.getAttribute('href')).toBe('/outer');
    }
  );
  it.each(nested)(
    'keeps %s navigable inside blocked outer links and formatting',
    (source, label, href) => {
      const { root } = mount(
        snapshot(`[outer *${source}*](javascript:evil)\n\n[ref]: /inner\n`)
      );
      expect(root.querySelectorAll('a')).toHaveLength(1);
      expect(root.querySelector('em > a')?.textContent).toBe(label);
      expect(root.querySelector('a')?.getAttribute('href')).toBe(href);
      expect(root.textContent).toBe(`outer ${label}`);
    }
  );
  it('propagates accepted-anchor context through formatting and blocked intermediate links', () => {
    const { root } = mount(
      snapshot('[outer *[middle [inner](/inner)](javascript:evil)*](/outer)')
    );
    expect(root.querySelectorAll('a')).toHaveLength(1);
    expect(root.querySelector('a > em')?.textContent).toBe('middle inner');
    expect(root.querySelector('a')?.textContent).toBe('outer middle inner');
  });
  it('retains DOM through repeated snapshots, appends and finish, then resets generation and reinterpreted kind', () => {
    const owner = createMarkdown({
      generation: 'a',
      phase: 'streaming',
      content: 'Stable.\n\n- item\n\n| a |\n| --- |\n| b |\n\n',
    });
    const { root, update } = mount(owner.getSnapshot());
    const selectors = [
      'p',
      'ul',
      'li',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
    ];
    const initial = selectors.map((s) => root.querySelector(s));
    expect(initial.every(Boolean)).toBe(true);
    update({ ...owner.getSnapshot() });
    owner.update({
      ...owner.getSnapshot().document,
      content: owner.getSnapshot().document.content + 'more',
    });
    update(owner.getSnapshot());
    owner.update({ ...owner.getSnapshot().document, phase: 'complete' });
    update(owner.getSnapshot());
    selectors.forEach((s, i) => expect(root.querySelector(s)).toBe(initial[i]));
    owner.update({ generation: 'b', phase: 'streaming', content: '-' });
    update(owner.getSnapshot());
    expect(initial.every((n) => !root.contains(n))).toBe(true);
    const paragraph = root.querySelector('p');
    owner.update({ generation: 'b', phase: 'streaming', content: '- item' });
    update(owner.getSnapshot());
    expect(root.contains(paragraph)).toBe(false);
    expect(root.querySelector('ul > li')).not.toBeNull();
  });
  it('scopes image errors to URL and generation including late events on retained old elements', () => {
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    const owner = createMarkdown(
      { generation: 'a', phase: 'streaming', content: '![alt](/one)' },
      { violationPolicy: 'rebuild' }
    );
    const { fixture, root, update } = mount(owner.getSnapshot());
    const old = root.querySelector('img');
    expect(old).not.toBeNull();
    if (!old) throw new Error('Expected initial image');
    old.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(root.querySelector('img')).toBeNull();
    owner.update({
      generation: 'a',
      phase: 'complete',
      content: '![alt](/two)',
    });
    update(owner.getSnapshot());
    const replacement = root.querySelector('img');
    if (!replacement) throw new Error('Expected replacement image');
    expect(replacement.getAttribute('src')).toBe('/two');
    old.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(root.querySelector('img')).toBe(replacement);
    replacement.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    owner.update({
      generation: 'b',
      phase: 'complete',
      content: '![alt](/two)',
    });
    update(owner.getSnapshot());
    const generation = root.querySelector('img');
    expect(generation).not.toBeNull();
    replacement.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(root.querySelector('img')).toBe(generation);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
  it('retains failures on equal context changes and leaves ownership and immutable input untouched on removal/remount', () => {
    const owner = createMarkdown({
      generation: 'a',
      phase: 'streaming',
      content: 'Stable ![alt](/image).',
    });
    const accepted = owner.getSnapshot();
    const { root, fixture, update } = mount(accepted);
    const p = root.querySelector('p');
    const image = root.querySelector('img');
    expect(image).not.toBeNull();
    if (!image) throw new Error('Expected initial image');
    image.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    const fallback = root.querySelector('[role="img"]');
    expect(fallback).not.toBeNull();
    update({ ...accepted });
    expect(root.querySelector('p')).toBe(p);
    expect(root.querySelector('[role="img"]')).toBe(fallback);
    fixture.destroy();
    expect(owner.getSnapshot()).toBe(accepted);
    expect(Object.isFrozen(accepted.root)).toBe(true);
    owner.update({
      ...accepted.document,
      content: accepted.document.content + ' More.',
      phase: 'complete',
    });
    const again = mount(owner.getSnapshot());
    expect(again.root.textContent).toContain('More.');
    expect(again.root.querySelector('img')).not.toBeNull();
    owner.dispose();
    again.update(owner.getSnapshot());
    expect(again.root.textContent).toContain('More.');
  });
  it('updates same-kind text in retained views and ignores an old image error after changing an unfailed URL', () => {
    const owner = createMarkdown(
      { generation: 'a', phase: 'complete', content: 'First ![alt](/one).' },
      { violationPolicy: 'rebuild' }
    );
    const { root, fixture, update } = mount(owner.getSnapshot());
    const paragraph = root.querySelector('p');
    const old = root.querySelector('img');
    expect(old).not.toBeNull();
    owner.update({
      generation: 'a',
      phase: 'complete',
      content: 'Second ![new alt](/two).',
    });
    update(owner.getSnapshot());
    expect(root.querySelector('p')).toBe(paragraph);
    expect(paragraph?.textContent).toBe('Second .');
    const replacement = root.querySelector('img');
    expect(replacement).not.toBe(old);
    expect(replacement?.getAttribute('src')).toBe('/two');
    expect(replacement?.alt).toBe('new alt');
    if (!old) throw new Error('Expected initial image');
    old.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(root.querySelector('img')).toBe(replacement);
  });
  it('exercises 26 node kinds from the real parser plus the hard-break fallback', () => {
    const parsed = snapshot(
      '# Head\n\ntext\nline *em* **strong** ~~del~~ `code` [link](/x) <https://example.test> ![alt](/i) [ref][x] [^cite] $m$ <span>html</span>\n\n> quote\n\n- item\n\n```ts\ncode\n```\n\n---\n\n| a |\n| --- |\n| b |\n\n<div>block</div>\n\n$$\nm\n$$\n\n[x]: /ref\n[^cite]: citation\n'
    );
    const seen = new Set<string>();
    const visit = (node: MarkdownNode) => {
      seen.add(node.type);
      if ('children' in node) node.children.forEach(visit);
    };
    if (!parsed.root) throw new Error('Expected parsed root');
    visit(parsed.root);
    expect([...seen].sort()).toEqual(
      Object.keys(dispositions)
        .filter((n) => n !== 'hard-break')
        .sort()
    );
    const actual = mount(parsed);
    expect(actual.root.querySelector('table')).not.toBeNull();
    const supplemented: MarkdownSnapshot = {
      ...parsed,
      root: {
        ...parsed.root,
        children: [
          {
            type: 'paragraph',
            id: 98,
            status: 'complete',
            parent: null,
            index: 0,
            children: [
              {
                type: 'hard-break',
                id: 99,
                status: 'complete',
                parent: null,
                index: 0,
              },
            ],
          },
        ],
      },
    };
    actual.update(supplemented);
    expect(actual.root.querySelector('p > br')).not.toBeNull();
  });
});
