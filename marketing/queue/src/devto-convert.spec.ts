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

  it('relative image becomes absolute', () => {
    const out = convertMdxForDevto(doc('![chart](/blog/x/chart.png) and [docs](/docs/a) and [ext](https://a.dev/b)'), opts);
    expect(out.body).toContain('![chart](https://threadplane.ai/blog/x/chart.png)');
    expect(out.body).toContain('[docs](https://threadplane.ai/docs/a)');
    expect(out.body).toContain('[ext](https://a.dev/b)');
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
