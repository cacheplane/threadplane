import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildWhitepaperHtml,
  compileChapters,
  PAPERS,
  parsePaperArgs,
  type PaperId,
} from './whitepaper-document';
import { FIELD_REPORT } from '../src/lib/field-report';

describe('authored whitepaper rendering', () => {
  it('keeps literal Angular tags and blank lines in code readable', () => {
    const chapters = compileChapters(
      '## Example\n\nUse `<chat>`.\n\n<!-- example:chat -->',
      {
        chat: 'template: `<chat [agent]="chat" />`\n\nconst value = 1;',
      }
    );
    expect(chapters).toHaveLength(1);
    expect(chapters[0].html).toContain('<code>&lt;chat&gt;</code>');
    expect(chapters[0].html).toContain('&lt;chat [agent]=');
    expect(chapters[0].html).toContain('\n\nconst value = 1;');
    expect(chapters[0].html).not.toMatch(/<p>\s*<pre/);
  });

  it('renders real links and anchors for every chapter', () => {
    const chapters = compileChapters(
      '## State & UI\n\n[Guide](https://threadplane.ai/docs)\n\n## Next\n\nRead on.',
      {}
    );
    expect(chapters.map((chapter) => chapter.id)).toEqual(['state-ui', 'next']);
    expect(chapters[0].html).toContain('href="https://threadplane.ai/docs"');
  });

  it('fails on a missing example rather than silently publishing an empty block', () => {
    expect(() =>
      compileChapters('## Setup\n\n<!-- example:missing -->', {})
    ).toThrow(/missing/);
  });

  it('renders an authored network diagram with a mobile text equivalent', () => {
    const chapters = compileChapters(
      '## Ownership\n\n<!-- diagram:ownership -->',
      {}
    );
    expect(chapters[0].html).toContain('<svg');
    expect(chapters[0].html).toContain('class="diagram-mobile"');
    expect(chapters[0].html).toContain('Angular observer');
    expect(chapters[0].html).toContain('React observer');
    expect(() =>
      compileChapters('## Flow\n\n<!-- diagram:missing -->', {})
    ).toThrow(/Unknown diagram/);
  });

  it('rejects empty papers and duplicate chapter anchors', () => {
    expect(() => compileChapters('No chapters.', {})).toThrow(/chapter/i);
    expect(() => compileChapters('## Same\n\nA\n\n## Same\n\nB', {})).toThrow(
      /duplicate/i
    );
  });

  it('preserves paper selection and the old rerender flag without ignoring typos', () => {
    expect(parsePaperArgs(['--paper', 'chat'])).toEqual(['chat']);
    expect(parsePaperArgs(['--rerender', '--paper=angular'])).toEqual([
      'angular',
    ]);
    expect(parsePaperArgs([])).toEqual([
      'overview',
      'angular',
      'render',
      'chat',
    ]);
    expect(() => parsePaperArgs(['--paper', 'unknown'])).toThrow(/unknown/i);
    expect(() => parsePaperArgs(['--paper'])).toThrow();
    expect(() => parsePaperArgs(['--papre=chat'])).toThrow();
  });
});

describe('published whitepapers', () => {
  const website = resolve(__dirname, '..');
  const repo = resolve(website, '../..');
  const exampleDirectory = join(__dirname, 'whitepapers/examples');
  const examples = Object.fromEntries(
    readdirSync(exampleDirectory)
      .filter((file) => /\.tsx?$/.test(file))
      .map((file) => [
        file.replace(/\.tsx?$/, ''),
        readFileSync(join(exampleDirectory, file), 'utf8'),
      ])
  );
  const font = (file: string) =>
    readFileSync(join(website, 'src/app/card/fonts', file)).toString('base64');
  const fonts = {
    regular: font('Archivo-Regular.ttf'),
    semibold: font('Archivo-SemiBold.ttf'),
    mono: font('JetBrainsMono-Bold.ttf'),
    logo: readFileSync(join(website, 'src/app/icon.svg')).toString('base64'),
  };

  it.each(Object.keys(PAPERS) as PaperId[])(
    '%s is built from current authored content and checked examples',
    (id) => {
      const source = readFileSync(
        join(website, 'content/whitepapers', `${id}.md`),
        'utf8'
      );
      const chapters = compileChapters(source, examples);
      const html = buildWhitepaperHtml(id, chapters, fonts);
      for (const [url] of source.matchAll(/https:\/\/[^)\s]+/g)) {
        const reference = new URL(url);
        expect(reference.protocol).toBe('https:');
        expect(reference.hostname).not.toBe('threadplane.com');
      }
      expect(
        readFileSync(join(website, 'public', PAPERS[id].html), 'utf8')
      ).toBe(html);
      expect(html).not.toMatch(
        /<!-- (?:example|diagram):|\b(?:streamResource|provideStreamResource|provideRenderRegistry)\b/
      );
      expect(html).not.toMatch(/(?:src|href)="https?:\/\/fonts\./);
      expect(html).toContain('Angular');
      expect(html).toContain('React');
      if (id === 'overview')
        expect(chapters.map(({ title }) => title)).toEqual(
          FIELD_REPORT.chapters
        );
      const links = [
        ...source.matchAll(/https:\/\/threadplane\.ai(\/docs\/[^)\s#]+)/g),
      ];
      expect(links.length).toBeGreaterThan(0);
      for (const framework of ['angular', 'react']) {
        expect(
          links.some(([, route]) => route.startsWith(`/docs/${framework}/`)),
          `${id}: missing ${framework} implementation reference`
        ).toBe(true);
      }
      for (const [, route] of links) {
        const contentPath = join(website, 'content', route.slice(1));
        expect(
          existsSync(`${contentPath}.mdx`) ||
            existsSync(join(contentPath, 'index.mdx')),
          route
        ).toBe(true);
      }
    }
  );

  it('compiles the exact printed examples against local APIs and Angular templates', () => {
    const result = spawnSync(
      process.execPath,
      [
        join(repo, 'node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js'),
        '-p',
        join(__dirname, 'whitepapers/tsconfig.json'),
      ],
      { cwd: repo, encoding: 'utf8', timeout: 90_000 }
    );
    expect(result.error, result.error?.message).toBeUndefined();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  }, 100_000);

  it('compiles the exact React examples against the native source-build APIs', () => {
    const result = spawnSync(
      process.execPath,
      [
        join(repo, 'node_modules/typescript/bin/tsc'),
        '-p',
        join(__dirname, 'whitepapers/tsconfig.react.json'),
      ],
      { cwd: repo, encoding: 'utf8', timeout: 90_000 }
    );
    expect(result.error, result.error?.message).toBeUndefined();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  }, 100_000);
});
