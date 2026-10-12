import { getExampleCodeContext, getWebsiteWorkspacePage } from './workspace-page';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { capabilityModules, getFrontendCapabilityDescriptor } from '@threadplane/cockpit-registry';
import { describe, expect, it } from 'vitest';
import {
  fenceFor,
  resolveExampleFile,
  sliceRegion,
  type ExampleCodeContext,
} from './example-code';

/**
 * Every docs page that embeds a runnable example teaches through that
 * example: it includes code with `<ExampleCode>`, and every include resolves
 * against the capability's declared assets by the same rule the component
 * uses at build time. Docs-only pages never include.
 *
 * The scan is textual: the tag must not appear in prose, fenced code, or MDX
 * comments on any docs page, or it counts as an include.
 */
const findWorkspaceRoot = (): string => {
  let directory = process.cwd();
  while (directory !== resolve(directory, '..')) {
    if (existsSync(join(directory, 'nx.json'))) return directory;
    directory = resolve(directory, '..');
  }
  throw new Error('workspace root (nx.json) not found');
};
const WORKSPACE_ROOT = findWorkspaceRoot();
const CONTENT_ROOT = join(WORKSPACE_ROOT, 'apps/website/content');

it('resolves every native Subagents article include from its registered sources and shared backend', () => {
  const canonical = capabilityModules.find(entry => entry.id === 'deep-agents-subagents-python');
  if (!canonical) throw new Error('Missing canonical Subagents');
  const react = getFrontendCapabilityDescriptor(canonical.manifestIdentity as never, 'react')!;
  const page = { docsPath: react.docsPath, assetPaths: [...react.codeAssetPaths, ...(react.backendAssetPaths ?? [])] };
  const context = contextFor(page);
  const article = readFileSync(join(WORKSPACE_ROOT, 'apps/website/src/components/docs/ReactDeepAgentsSubagentsPreview.tsx'), 'utf8');
  for (const include of includesIn(article)) {
    expect(resolveExampleFile(include.file, context)).toBe(include.file);
    expect(context.sources[include.file]?.length).toBeGreaterThan(0);
  }
  expect(includesIn(article)).toHaveLength(6);
  expect(page.assetPaths.some(path => /fixture|wire\.py|\.spec\./.test(path))).toBe(false);
  for (const path of page.assetPaths) expect(context.sources[path]?.length).toBeGreaterThan(0);
});
it('resolves every native Filesystem article include from its registered sources and shared backend', () => {
  const canonical = capabilityModules.find(entry => entry.id === 'deep-agents-filesystem-python');
  if (!canonical) throw new Error('Missing canonical Filesystem');
  const react = getFrontendCapabilityDescriptor(canonical.manifestIdentity as never, 'react')!;
  const page = { docsPath: react.docsPath, assetPaths: [...react.codeAssetPaths, ...(react.backendAssetPaths ?? [])] };
  const context = contextFor(page);
  const article = readFileSync(join(WORKSPACE_ROOT, 'apps/website/src/components/docs/ReactDeepAgentsFilesystemPreview.tsx'), 'utf8');
  for (const include of includesIn(article)) {
    expect(resolveExampleFile(include.file, context)).toBe(include.file);
    expect(context.sources[include.file]?.length).toBeGreaterThan(0);
  }
  expect(includesIn(article)).toHaveLength(8);
  expect(page.assetPaths.some(path => /fixture|wire\.py|\.spec\./.test(path))).toBe(false);
  for (const path of page.assetPaths) expect(context.sources[path]?.length).toBeGreaterThan(0);
});
it('resolves every native Planning article include from its registered sources and shared backend', () => {
  const canonical = capabilityModules.find(entry => entry.id === 'deep-agents-planning-python')!;
  const react = getFrontendCapabilityDescriptor(canonical.manifestIdentity as never, 'react')!;
  const page = { docsPath: react.docsPath, assetPaths: [...react.codeAssetPaths, ...(react.backendAssetPaths ?? [])] };
  const context = contextFor(page);
  const article = readFileSync(join(WORKSPACE_ROOT, 'apps/website/src/components/docs/ReactDeepAgentsPlanningPreview.tsx'), 'utf8');
  for (const include of includesIn(article)) {
    expect(resolveExampleFile(include.file, context)).toBe(include.file);
    expect(context.sources[include.file]?.length).toBeGreaterThan(0);
  }
  expect(includesIn(article)).toHaveLength(7);
  expect(page.assetPaths.some(path => /fixture|wire\.py|\.spec\./.test(path))).toBe(false);
  for (const path of page.assetPaths) expect(context.sources[path]?.length).toBeGreaterThan(0);
});

it('uses the actual Filesystem workspace labels and distinguishes unavailable records from invalid maps', () => {
  const article = readFileSync(join(WORKSPACE_ROOT, 'apps/website/src/components/docs/ReactDeepAgentsFilesystemPreview.tsx'), 'utf8');
  const panel = readFileSync(join(WORKSPACE_ROOT, 'cockpit/deep-agents/filesystem/react/src/workspace-panel.tsx'), 'utf8');
  for (const label of ['Live workspace', 'Paused · confirmed workspace', 'Saved workspace', 'Last confirmed workspace']) {
    expect(panel).toContain(label);
    expect(article).toContain(`**${label}**`);
  }
  expect(article).toContain('A malformed whole workspace map or unconfirmed checkpoint ownership blocks confirmation and decisions.');
  expect(article).toContain('Unsupported individual file records remain visibly unavailable and never supply literal file text');
});

interface MappedPage {
  readonly docsPath: string;
  readonly assetPaths: readonly string[];
}

/** docsPath → union of code assets across every descriptor sharing it. */
function mappedPages(): MappedPage[] {
  const byPath = new Map<string, Set<string>>();
  for (const descriptor of capabilityModules) {
    const assets = [
      ...descriptor.codeAssetPaths,
      ...(descriptor.backendAssetPaths ?? []),
    ];
    if (assets.length === 0) continue;
    const set = byPath.get(descriptor.docsPath) ?? new Set<string>();
    for (const asset of assets) set.add(asset);
    byPath.set(descriptor.docsPath, set);
  }
  return [...byPath].map(([docsPath, assets]) => ({
    docsPath,
    assetPaths: [...assets],
  }));
}

function mdxFor(docsPath: string): string {
  return readFileSync(join(CONTENT_ROOT, `${docsPath}.mdx`), 'utf8');
}

function contextFor(page: MappedPage): ExampleCodeContext {
  const sources: Record<string, string> = {};
  for (const path of page.assetPaths) {
    const full = join(WORKSPACE_ROOT, path);
    if (existsSync(full)) sources[path] = readFileSync(full, 'utf8');
  }
  return { docsPath: page.docsPath, assetPaths: page.assetPaths, sources };
}

interface Include {
  readonly file: string;
  readonly region?: string;
}

function includesIn(mdx: string): Include[] {
  return [...mdx.matchAll(/<ExampleCode\b([^>]*?)\/?>/g)].map(([, attrs]) => ({
    file: /\bfile="([^"]+)"/.exec(attrs)?.[1] ?? '',
    region: /\bregion="([^"]+)"/.exec(attrs)?.[1],
  }));
}

function allDocsMdx(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      return entry.name.endsWith('.mdx') ? [path] : [];
    });
  return walk(join(CONTENT_ROOT, 'docs'));
}

describe('docs pages teach through their example', () => {
  const pages = mappedPages();
  const mappedPaths = new Set(pages.map((page) => page.docsPath));

  it('sees the registry and the content tree', () => {
    expect(pages.length).toBeGreaterThan(30);
    expect(allDocsMdx().length).toBeGreaterThan(50);
  });

  it('has an MDX file for every mapped page', () => {
    for (const page of pages) {
      expect(
        existsSync(join(CONTENT_ROOT, `${page.docsPath}.mdx`)),
        page.docsPath
      ).toBe(true);
    }
  });

  it('includes at least one example file on every mapped page', () => {
    const missing = pages
      .filter((page) => includesIn(mdxFor(page.docsPath)).length === 0)
      .map((page) => page.docsPath);
    expect(
      missing,
      'mapped pages with no <ExampleCode>; every mapped page teaches through its example'
    ).toEqual([]);
  });

  it('resolves every include against the capability assets', () => {
    for (const page of pages) {
      const context = contextFor(page);
      for (const include of includesIn(mdxFor(page.docsPath))) {
        const { file, region } = include;
        const label = `${page.docsPath} <ExampleCode file="${file}">`;
        expect(file, label).not.toBe('');
        const path = resolveExampleFile(file, context);
        if (region) {
          expect(
            () => sliceRegion(context.sources[path], region, path),
            label
          ).not.toThrow();
        }
      }
    }
  });

  it('never includes on a docs-only page', () => {
    const offenders = allDocsMdx()
      .map((file) => '/' + relative(CONTENT_ROOT, file).replace(/\.mdx$/, ''))
      .filter((docsPath) => !mappedPaths.has(docsPath))
      .filter((docsPath) => includesIn(mdxFor(docsPath)).length > 0);
    expect(offenders, 'docs-only pages must not use <ExampleCode>').toEqual([]);
  });
});

it('resolves every native Skills article include and the complete read-only backend', () => {
  const canonical = capabilityModules.find(entry => entry.id === 'deep-agents-skills-python')!;
  const react = getFrontendCapabilityDescriptor(canonical.manifestIdentity as never, 'react')!;
  expect(react).toBeDefined();
  const page = { docsPath: react.docsPath, assetPaths: [...react.codeAssetPaths, ...(react.backendAssetPaths ?? [])] };
  const context = contextFor(page);
  const article = readFileSync(join(WORKSPACE_ROOT, 'apps/website/src/components/docs/ReactDeepAgentsSkillsPreview.tsx'), 'utf8');
  expect(includesIn(article)).toHaveLength(8);
  for (const include of includesIn(article)) {
    expect(resolveExampleFile(include.file, context)).toBe(include.file);
    expect(context.sources[include.file]?.length).toBeGreaterThan(0);
  }
  expect(page.assetPaths).toContain('cockpit/deep-agents/skills/python/src/skills_readonly.py');
  expect(page.assetPaths.some(path => /fixture|wire\.py|\.spec\./.test(path))).toBe(false);
  for (const path of page.assetPaths) expect(context.sources[path]?.length).toBeGreaterThan(0);
});

it('loads every bundled Skills Markdown asset as literal code for both frontends', async () => {
  const model = await getWebsiteWorkspacePage({ docsPath: '/docs/deep-agents/capabilities/skills', title: 'Skills' });
  const react = model.frontendVariants?.react;
  expect(react).toBeDefined();
  if (!react) throw new Error('Missing native Skills workspace');
  const markdown = ['skills/runway-analysis/SKILL.md', 'skills/runway-analysis/reference/margins.md', 'skills/weather-brief/SKILL.md'].map(file => `cockpit/deep-agents/skills/python/${file}`);
  const backend = ['src/graph.py', 'src/skills_readonly.py', ...markdown.map(path => path.replace('cockpit/deep-agents/skills/python/', ''))].map(file => `cockpit/deep-agents/skills/python/${file}`);
  for (const variant of [model, react]) {
    const context = getExampleCodeContext(variant);
    expect(context).not.toBeNull();
    if (!context) throw new Error('Missing Skills source context');
    expect(variant.presentation.kind).toBe('capability');
    if (variant.presentation.kind !== 'capability') throw new Error('Missing Skills capability');
    expect(variant.presentation.backendAssetPaths).toEqual(backend);
    for (const path of markdown) {
      const literal = readFileSync(join(WORKSPACE_ROOT, path), 'utf8');
      expect(resolveExampleFile(path, context)).toBe(path);
      expect(context.sources[path]).toBe(literal);
      expect(variant.contentBundle.codeFiles[path]).not.toContain('File not found:');
      expect(fenceFor(context.sources[path], path)).toMatch(/^`{3,}md\n/);
    }
  }
});
