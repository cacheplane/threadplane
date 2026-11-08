import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFrontmatterDescription } from './docs';
import { META_DESCRIPTION_MAX, clampMetaDescription } from './site-metadata';
import { resolveWebsiteDir } from './website-dir';

/**
 * Mechanical authoring rules for `content/**` MDX.
 *
 * Every rule here stands for a defect the accuracy audit found by hand and
 * that no build step catches: the page still renders, it just renders wrong.
 * Each one reports the offending `path:line`, so a failure names the file to
 * open rather than the rule that fired.
 */
const WEBSITE_ROOT = resolveWebsiteDir();
const CONTENT_ROOT = join(WEBSITE_ROOT, 'content');
const DOCS_ROOT = join(CONTENT_ROOT, 'docs');
const CALLOUT_COMPONENT = 'src/components/docs/mdx/Callout.tsx';
const CARD_COMPONENT = 'src/components/docs/mdx/Card.tsx';

interface MdxFile {
  /** Relative to `apps/website`, so a failure reads `content/docs/...`. */
  readonly relativePath: string;
  readonly content: string;
}

function mdxFiles(directory: string): MdxFile[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return mdxFiles(path);
    if (!entry.isFile() || !entry.name.endsWith('.mdx')) return [];
    return [
      {
        relativePath: relative(WEBSITE_ROOT, path),
        content: readFileSync(path, 'utf8'),
      },
    ];
  });
}

function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

/**
 * Opening tags for one MDX component. `[^>]` matches newlines, so a tag whose
 * props wrap across lines is found the same as a one-liner.
 */
function openingTags(
  file: MdxFile,
  component: string
): { readonly tag: string; readonly location: string }[] {
  const pattern = new RegExp(`<${component}\\b[^>]*>`, 'g');
  return [...file.content.matchAll(pattern)].map((match) => ({
    tag: match[0],
    location: `${file.relativePath}:${lineNumberAt(file.content, match.index)}`,
  }));
}

// ---------------------------------------------------------------------------
// Rule 1 — `<Card icon>` prints the prop verbatim.
// ---------------------------------------------------------------------------

/**
 * `Card` has no icon lookup and, since the dead prop was deleted, no `icon`
 * prop at all. MDX props are not type-checked, so an `icon` an author adds is
 * accepted by the compiler and then silently dropped — and while the prop
 * existed it rendered its own value as text (`icon="rocket"` printed
 * "rocket"). Either way the page never shows what the author meant.
 */
function findCardIconProps(files: readonly MdxFile[]): string[] {
  return files.flatMap((file) =>
    openingTags(file, 'Card')
      .filter(({ tag }) => /\sicon\s*=/.test(tag))
      .map(({ location }) => location)
  );
}

// ---------------------------------------------------------------------------
// Rule 2 — every docs page describes itself.
// ---------------------------------------------------------------------------

/**
 * With no frontmatter `description`, `getDocDescription()` falls back to the
 * page's first paragraph and then to the library blurb, so unrelated pages
 * ship identical meta descriptions. A description longer than
 * {@link META_DESCRIPTION_MAX} is silently clamped mid-sentence instead.
 */
function findDescriptionDefects(files: readonly MdxFile[]): string[] {
  return files.flatMap((file) => {
    const description = readFrontmatterDescription(file.content)?.trim();
    if (!description) return [`${file.relativePath}: no frontmatter description`];
    if (clampMetaDescription(description) !== description) {
      return [
        `${file.relativePath}: description is ${description.length} characters, clamped at ${META_DESCRIPTION_MAX}`,
      ];
    }
    return [];
  });
}

// ---------------------------------------------------------------------------
// Rule 3 — `<Callout type>` outside the union renders unstyled.
// ---------------------------------------------------------------------------

/**
 * The allowed set is read out of the component so the guard cannot drift from
 * it. `Callout` indexes `ICON_PATHS[type]` with no fallback, so an unknown
 * type (`type="note"` was the one in the wild) renders an empty icon and an
 * unstyled band.
 */
function calloutTypesFrom(source: string): string[] {
  const union = source.match(/type\s+CalloutType\s*=\s*([^;]+);/)?.[1];
  if (!union) {
    throw new Error(`CalloutType union not found in ${CALLOUT_COMPONENT}`);
  }
  return [...union.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function findCalloutTypeDefects(
  files: readonly MdxFile[],
  allowed: readonly string[]
): string[] {
  return files.flatMap((file) =>
    openingTags(file, 'Callout').flatMap(({ tag, location }) => {
      const attribute = tag.match(/\stype\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/);
      if (!attribute) return []; // No type at all is fine; the component defaults.
      const literal = attribute[1] ?? attribute[2];
      if (literal === undefined) return [`${location}: type={${attribute[3]}}`];
      return allowed.includes(literal) ? [] : [`${location}: type="${literal}"`];
    })
  );
}

// ---------------------------------------------------------------------------
// Rule 4 — docs prose uses no contractions.
// ---------------------------------------------------------------------------

/**
 * Possessives are not contractions, so the patterns never match a bare `X's`:
 * the `'s` pattern is a closed list of pronouns and determiners that cannot
 * take a possessive in this prose, and the other patterns end in suffixes no
 * possessive uses.
 */
const CONTRACTION_PATTERNS: readonly RegExp[] = [
  /\b[A-Za-z]+n['’]t\b/g, // does not, cannot, is not
  /\b[A-Za-z]+['’](?:re|ve|ll|m|d)\b/g, // you are, we have, it will, I am, we would
  /\b(?:everything|he|here|how|it|let|nothing|one|she|something|that|there|this|what|when|where|which|who|why)['’]s\b/gi,
];

/** `## What's Next` is the site's section convention and stays as written. */
const WHATS_HEADING = /^#{1,6}\s+What['’]s\b/;

/** Blank out code so a contraction inside a sample is not prose. Line numbers survive. */
function withoutCode(content: string): string {
  const blank = (block: string): string => block.replace(/[^\n]/g, ' ');
  return content
    .replace(/```[\s\S]*?```/g, blank)
    .replace(/`[^`\n]*`/g, blank)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, blank);
}

function findContractions(files: readonly MdxFile[]): string[] {
  return files.flatMap((file) =>
    withoutCode(file.content)
      .split('\n')
      .flatMap((line, index) => {
        if (WHATS_HEADING.test(line.trim())) return [];
        const found = CONTRACTION_PATTERNS.flatMap((pattern) => [
          ...line.matchAll(pattern),
        ]).map((match) => match[0]);
        if (found.length === 0) return [];
        return [`${file.relativePath}:${index + 1}: ${found.join(', ')}`];
      })
  );
}

// ---------------------------------------------------------------------------

const CONTENT_FILES = mdxFiles(CONTENT_ROOT);
const DOCS_FILES = mdxFiles(DOCS_ROOT);

describe('docs content rules', () => {
  it('scans the whole authored MDX tree', () => {
    const paths = CONTENT_FILES.map((file) => file.relativePath);
    expect(paths.length).toBeGreaterThan(100);
    expect(paths).toContain('content/docs/angular/chat/getting-started/introduction.mdx');
    expect(paths).toContain(
      'content/blog/2026-05-28-human-in-the-loop-langgraph-agents-in-angular.mdx'
    );
    expect(DOCS_FILES.length).toBeGreaterThan(100);
    expect(
      DOCS_FILES.every((file) => file.relativePath.startsWith('content/docs/'))
    ).toBe(true);
  });

  it('passes no icon prop to Card, which does not accept one', () => {
    expect(
      readFileSync(join(WEBSITE_ROOT, CARD_COMPONENT), 'utf8'),
      `${CARD_COMPONENT} must not reintroduce an icon prop without an icon lookup`
    ).not.toMatch(/\bicon\b/i);
    expect(findCardIconProps(CONTENT_FILES)).toEqual([]);
  });

  it('detects an icon prop wherever it sits in the tag', () => {
    const content = [
      '<Card title="A" href="/a">body</Card>',
      '<Card icon="rocket" title="B" href="/b">body</Card>',
      '<Card',
      '  title="C"',
      '  icon="star"',
      '  href="/c"',
      '>body</Card>',
      '<CardGroup icon="nope">',
    ].join('\n');

    expect(findCardIconProps([{ relativePath: 'p.mdx', content }])).toEqual([
      'p.mdx:2',
      'p.mdx:3',
    ]);
  });

  it('gives every docs page its own frontmatter description', () => {
    expect(findDescriptionDefects(DOCS_FILES)).toEqual([]);
  });

  it('reports a missing description and one long enough to be clamped', () => {
    const long = `A${'b'.repeat(META_DESCRIPTION_MAX)} c`;
    const files: MdxFile[] = [
      { relativePath: 'ok.mdx', content: '---\ndescription: A short one.\n---\n# T\n' },
      { relativePath: 'none.mdx', content: '---\ntitle: T\n---\n# T\n' },
      { relativePath: 'empty.mdx', content: '---\ndescription: \n---\n# T\n' },
      { relativePath: 'bare.mdx', content: '# T\n' },
      { relativePath: 'long.mdx', content: `---\ndescription: ${long}\n---\n# T\n` },
    ];

    expect(findDescriptionDefects(files).map((entry) => entry.split(':')[0])).toEqual([
      'none.mdx',
      'empty.mdx',
      'bare.mdx',
      'long.mdx',
    ]);
  });

  it('reads the Callout union out of the component', () => {
    const source = readFileSync(join(WEBSITE_ROOT, CALLOUT_COMPONENT), 'utf8');
    // Update this list, the docs style rule, and any affected pages together.
    expect([...calloutTypesFrom(source)].sort()).toEqual([
      'danger',
      'info',
      'tip',
      'warning',
    ]);
    expect(() => calloutTypesFrom('type Other = 1;')).toThrow(/CalloutType union/);
  });

  it('uses only Callout types the component styles', () => {
    const source = readFileSync(join(WEBSITE_ROOT, CALLOUT_COMPONENT), 'utf8');
    expect(findCalloutTypeDefects(CONTENT_FILES, calloutTypesFrom(source))).toEqual([]);
  });

  it('flags an unknown Callout type and leaves a typeless Callout alone', () => {
    const content = [
      '<Callout>plain</Callout>',
      '<Callout type="tip">fine</Callout>',
      '<Callout type="note" title="T">wrong</Callout>',
      '<Callout type={kind}>wrong</Callout>',
    ].join('\n');

    expect(
      findCalloutTypeDefects([{ relativePath: 'p.mdx', content }], [
        'tip',
        'warning',
        'info',
        'danger',
      ])
    ).toEqual(['p.mdx:3: type="note"', 'p.mdx:4: type={kind}']);
  });

  it('writes docs prose without contractions', () => {
    expect(findContractions(DOCS_FILES)).toEqual([]);
  });

  it('flags contractions without flagging possessives or the What’s Next heading', () => {
    const content = [
      "The agent's state and the component's inputs stay intact.", // 1 possessive
      "## What's Next", // 2 site convention
      "It doesn't stream.", // 3
      "You're holding a signal.", // 4
      "That's the whole contract.", // 5
      "The graph would’ve resumed.", // 6
      'Run `it doesn\'t matter` inline.', // 7 code span
      '```ts', // 8
      "// you're inside a fence", // 9
      '```', // 10
      "The user's cannot-be-empty note.", // 11 possessive
    ].join('\n');

    expect(findContractions([{ relativePath: 'p.mdx', content }])).toEqual([
      "p.mdx:3: doesn't",
      "p.mdx:4: You're",
      "p.mdx:5: That's",
      'p.mdx:6: would’ve',
    ]);
  });
});
