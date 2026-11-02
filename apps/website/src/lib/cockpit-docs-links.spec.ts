import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  COCKPIT_DOCS_LINKS,
  COCKPIT_TOPICS_WITHOUT_DOCS,
  NO_COCKPIT_DOCS_LINK,
  cockpitManifest,
} from '@threadplane/cockpit-registry';
import { describe, expect, it } from 'vitest';
import { docsConfig } from './docs-config';

/**
 * Website-owned guard for registry capability links into the real docs tree.
 *
 * The link table cannot be derived from legacy Cockpit path segments: docs
 * routes and capability identities intentionally have different shapes.
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
const DOCS_CONTENT_ROOT = join(WORKSPACE_ROOT, 'apps/website/content/docs');

/** Every `/docs/<library>/<section>/<slug>` offered by Website navigation. */
const navRoutes = new Set(
  docsConfig.flatMap((library) =>
    library.sections.flatMap((section) =>
      section.pages.map(
        (page) => page.href ?? `/docs/${library.id}/${section.id}/${page.slug}`
      )
    )
  )
);

/** Every three-segment docs route backed by an authored `.mdx` file. */
const contentRoutes = new Set<string>();
for (const library of readdirSync(DOCS_CONTENT_ROOT, {
  withFileTypes: true,
})) {
  if (!library.isDirectory()) continue;
  const libraryDir = join(DOCS_CONTENT_ROOT, library.name);
  for (const section of readdirSync(libraryDir, { withFileTypes: true })) {
    if (!section.isDirectory()) continue;
    const sectionDir = join(libraryDir, section.name);
    for (const file of readdirSync(sectionDir)) {
      if (!file.endsWith('.mdx')) continue;
      contentRoutes.add(
        `/docs/${library.name}/${section.name}/${file.slice(0, -'.mdx'.length)}`
      );
    }
  }
}

interface DescriptorDocsPath {
  readonly file: string;
  readonly key: string;
  readonly docsPath: string;
}

/**
 * Standalone examples duplicate their descriptors, so scan every leaf rather
 * than relying on the subset imported by a package entry point.
 */
const readDescriptorDocsPaths = (): DescriptorDocsPath[] => {
  const results: DescriptorDocsPath[] = [];
  const cockpitRoot = join(WORKSPACE_ROOT, 'cockpit');
  for (const product of readdirSync(cockpitRoot, { withFileTypes: true })) {
    if (!product.isDirectory()) continue;
    const productDir = join(cockpitRoot, product.name);
    for (const topic of readdirSync(productDir, { withFileTypes: true })) {
      if (!topic.isDirectory()) continue;
      const topicDir = join(productDir, topic.name);
      for (const lane of readdirSync(topicDir, { withFileTypes: true })) {
        if (!lane.isDirectory()) continue;
        const file = join(topicDir, lane.name, 'src/index.ts');
        if (!existsSync(file)) continue;
        const source = readFileSync(file, 'utf8');
        const identity =
          /manifestIdentity:\s*\{[^}]*?product:\s*'([^']+)'[^}]*?section:\s*'([^']+)'[^}]*?topic:\s*'([^']+)'/s.exec(
            source
          );
        const declared = /\n {2}docsPath: '([^']*)',/.exec(source);
        if (!identity || !declared) continue;
        results.push({
          file: file.slice(WORKSPACE_ROOT.length),
          key: `${identity[1]}/${identity[2]}/${identity[3]}`,
          docsPath: declared[1],
        });
      }
    }
  }
  return results;
};

const descriptors = readDescriptorDocsPaths();

describe('Cockpit registry links into Website docs', () => {
  it('derives nonempty docs inventories from Website navigation and content', () => {
    expect(navRoutes.size).toBeGreaterThan(50);
    expect(contentRoutes.size).toBeGreaterThan(50);
  });

  it('points every nonblank mapping at both Website content and navigation', () => {
    const broken = Object.entries(COCKPIT_DOCS_LINKS)
      .filter(([, path]) => path !== NO_COCKPIT_DOCS_LINK)
      .filter(([, path]) => !contentRoutes.has(path) || !navRoutes.has(path))
      .map(([key, path]) => `${key} -> ${path}`);

    expect(broken).toEqual([]);
  });

  it('blanks exactly the topics explicitly known to have no docs', () => {
    const blanked = Object.entries(COCKPIT_DOCS_LINKS)
      .filter(([, path]) => path === NO_COCKPIT_DOCS_LINK)
      .map(([key]) => key)
      .sort();

    expect(blanked).toEqual([...COCKPIT_TOPICS_WITHOUT_DOCS].sort());
  });

  it('maps every manifest entry', () => {
    const unmapped = cockpitManifest
      .filter(
        (entry) =>
          !(
            `${entry.product}/${entry.section}/${entry.topic}` in
            COCKPIT_DOCS_LINKS
          )
      )
      .map((entry) => `${entry.product}/${entry.section}/${entry.topic}`);

    expect(unmapped).toEqual([]);
  });

  it('keeps every per-example descriptor in step with the shared table', () => {
    expect(descriptors.length).toBeGreaterThan(60);

    const drifted = descriptors
      .filter(({ key, docsPath }) => docsPath !== COCKPIT_DOCS_LINKS[key])
      .map(
        ({ file, key, docsPath }) =>
          `${file}: ${key} declares ${docsPath || '(blank)'}`
      );

    expect(drifted).toEqual([]);
  });

  it('declares no five-segment legacy docs path anywhere', () => {
    const legacy = descriptors
      .filter(({ docsPath }) => docsPath.split('/').filter(Boolean).length > 4)
      .map(({ file, docsPath }) => `${file}: ${docsPath}`);

    expect(legacy).toEqual([]);
  });
});
