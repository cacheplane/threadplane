import { describe, expect, it } from 'vitest';
import { convertMdxForDevto } from './devto-convert.ts';

const opts = { siteOrigin: 'https://threadplane.ai', slug: 'my-post' } as const;
const doc = (body: string, tags = '[a]') =>
  `---\ntitle: 'Hello'\ndescription: "A post"\ndate: 2026-11-03\ntags: ${tags}\nauthor: brian\n---\n\n${body}\n`;

describe('convertMdxForDevto', () => {
  it('splits frontmatter into fields', () => {
    const out = convertMdxForDevto(doc('Body.'), opts);
    expect(out.title).toBe('Hello');
    expect(out.description).toBe('A post');
    expect(out.body.trim()).toBe('Body.');
  });

  it('callout becomes blockquote', () => {
    const out = convertMdxForDevto(
      doc('<Callout type="info">Careful here.</Callout>\n\n<Callout type="info" title="Heads up">\nLine one.\n</Callout>'),
      opts
    );
    expect(out.body).toContain('> Careful here.');
    expect(out.body).toContain('> **Heads up**');
    expect(out.body).toContain('> Line one.');
    expect(out.body).not.toContain('<Callout');
  });

  it('unknown component throws', () => {
    expect(() => convertMdxForDevto(doc('<ArchFlowDiagram foo="1" />'), opts)).toThrow(
      'unsupported component <ArchFlowDiagram>'
    );
  });

  it('ignores components inside code fences and inline code', () => {
    const out = convertMdxForDevto(doc('Use `<Foo />` here.\n\n```html\n<Bar />\n```'), opts);
    expect(out.body).toContain('<Bar />');
  });

  const utm = 'utm_source=devto&utm_medium=social&utm_campaign=my-post';

  it('relative image becomes absolute', () => {
    const out = convertMdxForDevto(doc('![chart](/blog/x/chart.png) and [ext](https://a.dev/b)'), opts);
    expect(out.body).toContain('![chart](https://threadplane.ai/blog/x/chart.png)');
    expect(out.body).toContain('[ext](https://a.dev/b)');
  });

  it('relative link gains devto utm', () => {
    const out = convertMdxForDevto(doc('[docs](/docs/a) and [q](/docs/a?x=1)'), opts);
    expect(out.body).toContain(`[docs](https://threadplane.ai/docs/a?${utm})`);
    expect(out.body).toContain(`[q](https://threadplane.ai/docs/a?x=1&${utm})`);
  });

  it('absolute threadplane link gains utm and keeps its fragment', () => {
    const out = convertMdxForDevto(doc('[a](https://threadplane.ai/docs/a#part) [b](https://a.dev/b)'), opts);
    expect(out.body).toContain(`[a](https://threadplane.ai/docs/a?${utm}#part)`);
    expect(out.body).toContain('[b](https://a.dev/b)');
  });

  it('images and canonical stay bare', () => {
    const out = convertMdxForDevto(doc('![c](/x.png) ![d](https://threadplane.ai/y.png)'), opts);
    expect(out.body).toContain('![c](https://threadplane.ai/x.png)');
    expect(out.body).toContain('![d](https://threadplane.ai/y.png)');
    expect(out.body).not.toContain('utm_');
  });

  it('relative img src in a figure becomes absolute', () => {
    const out = convertMdxForDevto(
      doc('<figure>\n<img src="/blog/a.png" alt="a" />\n<a href="/docs/z">z</a>\n</figure>'),
      opts
    );
    expect(out.body).toContain('src="https://threadplane.ai/blog/a.png"');
    expect(out.body).toContain(`href="https://threadplane.ai/docs/z?${utm}"`);
  });

  it('inline code links stay unchanged', () => {
    const out = convertMdxForDevto(
      doc('Use `[docs](/docs/a)` and ``<a href="/x"> `y` `` here [real](/docs/r).'),
      opts
    );
    expect(out.body).toContain('`[docs](/docs/a)`');
    expect(out.body).toContain('``<a href="/x"> `y` ``');
    expect(out.body).toContain(`[real](https://threadplane.ai/docs/r?${utm})`);
  });

  it('link text containing inline code is still rewritten', () => {
    const out = convertMdxForDevto(
      doc('See [`useAgent`](/docs/api/use-agent) for details, and [x](`/a`) stays.'),
      opts
    );
    expect(out.body).toContain(`[`+'`useAgent`'+`](https://threadplane.ai/docs/api/use-agent?${utm})`);
    expect(out.body).toContain('[x](`/a`)');
    expect(out.body).not.toContain('\u0000');
  });

  it('fence inside callout throws', () => {
    expect(() => convertMdxForDevto(doc('<Callout>\n```ts\nx\n```\n</Callout>'), opts)).toThrow('code fence inside <Callout>');
  });

  it('unclosed callout throws', () => {
    expect(() => convertMdxForDevto(doc('<Callout>\nnever closed'), opts)).toThrow('unclosed <Callout>');
  });

  it('tags normalized to 4', () => {
    const out = convertMdxForDevto(doc('x', '[AG-UI, Angular, Agentic UI, webmcp, extra]'), opts);
    expect(out.tags).toEqual(['agui', 'angular', 'agenticui', 'webmcp']);
  });

  it('sentences split by blank lines outside code', () => {
    const out = convertMdxForDevto(
      doc('First sentence.\nSecond sentence.\n\n- item one\n- item two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst a = 1;\nconst b = 2;\n```'),
      opts
    );
    expect(out.body).toContain('First sentence.\n\nSecond sentence.');
    expect(out.body).toContain('- item one\n- item two');
    expect(out.body).toContain('| a | b |\n| - | - |\n| 1 | 2 |');
    expect(out.body).toContain('const a = 1;\nconst b = 2;');
  });
});
