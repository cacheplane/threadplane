import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  NO_COCKPIT_DOCS_LINK,
  cockpitManifest,
} from '@threadplane/cockpit-registry';
import {
  getAllDocSlugs,
  getDocBySlug,
  getDocMetadata,
  readFrontmatterDescription,
  stripFrontmatter,
} from './docs';
import {
  allDocsPages,
  docsConfig,
  findDocsPage,
  libraryIntroPath,
  specialDocsPages,
} from './docs-config';
import { getCanonicalUrl, getSitemapRoutes } from './site-metadata';

const internalDocsLinkPattern =
  /(?:href=["']|\]\()(?<href>\/docs\/[^"')#\s]+)/g;
const mdxLinkPattern =
  /(?:href=["']|\]\()(?<href>[^"')\s]+\.mdx(?:#[^"')\s]+)?)/g;

function findInternalDocsLinks(content: string): string[] {
  return Array.from(
    content.matchAll(internalDocsLinkPattern),
    (match) => match.groups?.href
  )
    .filter((href): href is string => Boolean(href))
    .map((href) => href.split('?')[0]);
}

// Resolved relative to this spec file so the path stays correct regardless of
// the runner's cwd (apps/website/ vs workspace root).
const contentRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'content',
  'docs'
);

function walkMdxFiles(dir: string): string[] {
  return fs.readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) return walkMdxFiles(fullPath);
    return entry.endsWith('.mdx') ? [fullPath] : [];
  });
}

function getConfiguredDocPath({
  library,
  section,
  slug,
}: {
  library: string;
  section: string;
  slug: string;
}): string {
  return path.join(contentRoot, library, section, `${slug}.mdx`);
}

function getAllConfiguredDocFiles(): Array<{
  id: string;
  filePath: string;
  content: string;
}> {
  const configured = getAllDocSlugs().map(({ library, section, slug }) => {
    const filePath = getConfiguredDocPath({ library, section, slug });
    return {
      id: `${library}/${section}/${slug}`,
      filePath,
      content: fs.readFileSync(filePath, 'utf8'),
    };
  });
  const special = specialDocsPages.map((page) => {
    const filePath = path.join(contentRoot, page.contentPath);
    return {
      id: page.path,
      filePath,
      content: fs.readFileSync(filePath, 'utf8'),
    };
  });
  return [...configured, ...special];
}

function findPackageImports(content: string): string[] {
  const imports = Array.from(
    content.matchAll(/from\s+['"](?<pkg>@threadplane\/[^'"]+)['"]/g),
    (match) => match.groups?.pkg
  );
  const dynamicImports = Array.from(
    content.matchAll(/import\(\s*['"](?<pkg>@threadplane\/[^'"]+)['"]\s*\)/g),
    (match) => match.groups?.pkg
  );
  return [...imports, ...dynamicImports].filter((pkg): pkg is string =>
    Boolean(pkg)
  );
}

describe('website docs bindings', () => {
  it('lists all doc slugs from config', () => {
    const slugs = getAllDocSlugs();
    expect(slugs.length).toBe(allDocsPages.length);
    expect(slugs).toContainEqual({
      library: 'langgraph',
      section: 'getting-started',
      slug: 'introduction',
    });
    expect(slugs).toContainEqual({
      library: 'langgraph',
      section: 'guides',
      slug: 'streaming',
    });
    expect(slugs).toContainEqual({
      library: 'render',
      section: 'getting-started',
      slug: 'introduction',
    });
    expect(slugs).toContainEqual({
      library: 'chat',
      section: 'getting-started',
      slug: 'introduction',
    });
    expect(slugs).toContainEqual({
      library: 'ag-ui',
      section: 'concepts',
      slug: 'architecture',
    });
    expect(slugs).toContainEqual({
      library: 'a2ui',
      section: 'getting-started',
      slug: 'introduction',
    });
  });

  it('loads every configured doc page', () => {
    for (const { library, section, slug } of getAllDocSlugs()) {
      expect(getDocBySlug(library, section, slug)).not.toBeNull();
    }
  });

  it('does not leave tracked MDX docs outside the configured docs inventory', () => {
    const configuredPaths = new Set(
      getAllDocSlugs().map((slug) => getConfiguredDocPath(slug))
    );
    for (const page of specialDocsPages) {
      configuredPaths.add(path.join(contentRoot, page.contentPath));
    }
    const unconfigured = walkMdxFiles(contentRoot)
      .filter((filePath) => !configuredPaths.has(filePath))
      .map((filePath) => path.relative(contentRoot, filePath));

    expect(unconfigured).toEqual([]);
  });

  it('loads a doc by library, section and slug', () => {
    const doc = getDocBySlug('langgraph', 'getting-started', 'introduction');
    expect(doc).not.toBeNull();
    expect(doc?.title).toBe('Introduction');
  });

  it('resolves page metadata for configured docs', () => {
    const metadata = getDocMetadata('ag-ui', 'reference', 'event-mapping');

    expect(metadata).toMatchObject({
      title: 'Event Mapping — AG-UI Docs — Threadplane',
      alternates: {
        canonical: '/docs/ag-ui/reference/event-mapping',
      },
      openGraph: {
        title: 'Event Mapping — AG-UI Docs — Threadplane',
        url: '/docs/ag-ui/reference/event-mapping',
      },
      twitter: {
        card: 'summary_large_image',
        title: 'Event Mapping — AG-UI Docs — Threadplane',
      },
    });
    expect(metadata?.description).toContain('AG-UI protocol events');
    expect(metadata?.description).not.toBe(
      'Adapter for AG-UI-compatible backends including CrewAI, Mastra, Microsoft AF, AG2, Pydantic AI, and AWS Strands'
    );
  });

  it('keeps every description within the search-snippet budget', () => {
    // GSC follow-up to #826: 160+ char descriptions get re-truncated by
    // Google mid-sentence. The clamp must also never leave the legacy
    // mid-word '...' cut.
    const slugs = getAllDocSlugs();
    expect(slugs.length).toBeGreaterThan(100); // sweep must not pass on an empty list
    for (const { library, section, slug } of slugs) {
      const description = getDocMetadata(library, section, slug)?.description;
      expect(description, `${library}/${section}/${slug}`).toBeTruthy();
      expect(
        description!.length,
        `${library}/${section}/${slug}`
      ).toBeLessThanOrEqual(160);
      expect(
        description!.endsWith('...'),
        `${library}/${section}/${slug}`
      ).toBe(false);
    }
  });

  it('derives mostly unique descriptions from page content', () => {
    const descriptions = getAllDocSlugs()
      .map(
        ({ library, section, slug }) =>
          getDocMetadata(library, section, slug)?.description
      )
      .filter((description): description is string => Boolean(description));

    const duplicateDescriptions = descriptions.filter(
      (description, index) => descriptions.indexOf(description) !== index
    );
    expect(duplicateDescriptions).toHaveLength(0);
  });

  // Both regressions below shipped together and hid each other: the description
  // regex silently ignored the frontmatter, so the only visible symptom was the
  // block rendering as Markdown — an <hr> plus a setext <h2> above the real <h1>.
  it('prefers a frontmatter description when `description` is the last key', () => {
    // Every real frontmatter block in content/docs/ ends on `description:`.
    const metadata = getDocMetadata('chat', 'guides', 'custom-catalogs');

    expect(metadata?.description).toBe(
      'Compose custom component catalogs for generative UI using ViewRegistry composition.'
    );
  });

  it('reads a frontmatter description that contains an apostrophe', () => {
    // The value pattern excluded every quote character, so a description with
    // a possessive never matched and the page silently fell back to its first
    // paragraph while declaring a description of its own.
    const metadata = getDocMetadata('chat', 'components', 'chat-reasoning');

    expect(metadata?.description).toBe(
      "The ChatReasoningComponent pill that expands to reveal an assistant's reasoning text, its five inputs, and the auto-collapse behavior."
    );
  });

  it('strips only a matched pair of surrounding quotes', () => {
    expect(readFrontmatterDescription("---\ndescription: 'Quoted.'\n---\n")).toBe(
      'Quoted.'
    );
    expect(readFrontmatterDescription('---\ndescription: "Quoted."\n---\n')).toBe(
      'Quoted.'
    );
    expect(
      readFrontmatterDescription("---\ndescription: The child's state.\n---\n")
    ).toBe("The child's state.");
    expect(readFrontmatterDescription('---\ntitle: T\n---\n')).toBeNull();
    expect(readFrontmatterDescription('---\ndescription:   \n---\n')).toBeNull();
    expect(readFrontmatterDescription('# No frontmatter\n')).toBeNull();
  });

  it('never leaks frontmatter keys into a derived description', () => {
    for (const { library, section, slug } of getAllDocSlugs()) {
      const description =
        getDocMetadata(library, section, slug)?.description ?? '';
      expect(description, `/docs/${library}/${section}/${slug}`).not.toMatch(
        /^title:/
      );
    }
  });

  it('exposes a render body with no frontmatter for every doc page', () => {
    for (const { library, section, slug } of getAllDocSlugs()) {
      const doc = getDocBySlug(library, section, slug);

      expect(
        doc?.body.startsWith('---'),
        `/docs/${library}/${section}/${slug}`
      ).toBe(false);
    }
  });

  it('strips a frontmatter block before the body is handed to MDX', () => {
    const source =
      '---\ntitle: X\ndescription: D.\n---\n\n# Heading\n\nBody.\n';

    expect(stripFrontmatter(source)).toBe('# Heading\n\nBody.\n');
  });

  it('leaves a body that merely starts with a thematic break alone', () => {
    // A leading `---` is only frontmatter when a closing fence follows it.
    const source = '---\n\n# Heading\n';

    expect(stripFrontmatter(source)).toBe(source);
  });

  it('includes every configured doc page in the sitemap routes', () => {
    const sitemapRoutes = getSitemapRoutes();

    for (const { library, section, slug } of getAllDocSlugs()) {
      expect(sitemapRoutes).toContain(`/docs/${library}/${section}/${slug}`);
    }
  });

  it('resolves canonical URLs against the production origin', () => {
    expect(getCanonicalUrl('/docs/langgraph/guides/streaming')).toBe(
      'https://threadplane.ai/docs/langgraph/guides/streaming'
    );
  });

  it('does not contain stale or broken internal docs links', () => {
    const validDocsRoutes = new Set([
      '/docs',
      ...getSitemapRoutes().filter((route) => route.startsWith('/docs/')),
    ]);
    const brokenLinks: string[] = [];

    for (const { library, section, slug } of getAllDocSlugs()) {
      const doc = getDocBySlug(library, section, slug);
      if (!doc) continue;

      for (const href of findInternalDocsLinks(doc.content)) {
        if (!validDocsRoutes.has(href)) {
          brokenLinks.push(`${library}/${section}/${slug} -> ${href}`);
        }
      }
    }

    expect(brokenLinks).toEqual([]);
  });

  it('does not link directly to source MDX files', () => {
    const mdxLinks: string[] = [];

    for (const doc of getAllConfiguredDocFiles()) {
      for (const match of doc.content.matchAll(mdxLinkPattern)) {
        const href = match.groups?.href;
        if (href) mdxLinks.push(`${doc.id} -> ${href}`);
      }
    }

    expect(mdxLinks).toEqual([]);
  });

  it('uses package imports that match published package entry points', () => {
    const validPackages = new Set([
      '@threadplane/a2ui',
      '@threadplane/ag-ui',
      '@threadplane/chat',
      '@threadplane/chat/debug',
      '@threadplane/chat/testing',
      '@threadplane/langgraph',
      '@threadplane/middleware/langgraph',
      '@threadplane/render',
      '@threadplane/telemetry',
      '@threadplane/telemetry/browser',
      '@threadplane/telemetry/node',
      '@threadplane/telemetry/shared',
    ]);

    const invalidImports: string[] = [];

    for (const { library, section, slug } of getAllDocSlugs()) {
      const doc = getDocBySlug(library, section, slug);
      if (!doc) continue;

      for (const pkg of findPackageImports(doc.content)) {
        if (!validPackages.has(pkg)) {
          invalidImports.push(`${library}/${section}/${slug} -> ${pkg}`);
        }
      }
    }

    expect(invalidImports).toEqual([]);
  });

  it('has generated API docs for every documented package surface', () => {
    const librariesWithApiDocs = [
      'langgraph',
      'chat',
      'render',
      'ag-ui',
      'a2ui',
      'middleware',
    ];
    const missingApiDocs = librariesWithApiDocs.filter((library) => {
      const apiDocsPath = path.join(
        contentRoot,
        library,
        'api',
        'api-docs.json'
      );
      if (!fs.existsSync(apiDocsPath)) return true;

      const entries = JSON.parse(
        fs.readFileSync(apiDocsPath, 'utf8')
      ) as unknown[];
      return entries.length === 0;
    });

    expect(missingApiDocs).toEqual([]);
  });

  it('keeps internal and ɵ adapter plumbing out of consumer API docs', () => {
    const prohibited: string[] = [];
    for (const library of ['langgraph', 'ag-ui']) {
      const apiDocsPath = path.join(
        contentRoot,
        library,
        'api',
        'api-docs.json'
      );
      const entries = JSON.parse(
        fs.readFileSync(apiDocsPath, 'utf8')
      ) as Array<{
        name: string;
        params?: Array<{ name: string }>;
        properties?: Array<{ name: string }>;
        methods?: Array<{ name: string; params?: Array<{ name: string }> }>;
      }>;
      for (const entry of entries) {
        const names = [
          entry.name,
          ...(entry.params ?? []).map((parameter) => parameter.name),
          ...(entry.properties ?? []).map((property) => property.name),
          ...(entry.methods ?? []).flatMap((method) => [
            method.name,
            ...(method.params ?? []).map((parameter) => parameter.name),
          ]),
        ];
        for (const name of names) {
          if (
            name.startsWith('ɵ') ||
            name === 'reportOperationFailure' ||
            name === 'protectsOperationErrors'
          ) {
            prohibited.push(`${library}:${entry.name}:${name}`);
          }
        }
      }
    }

    expect(prohibited).toEqual([]);
    const langGraphDocs = JSON.parse(
      fs.readFileSync(
        path.join(contentRoot, 'langgraph', 'api', 'api-docs.json'),
        'utf8'
      )
    ) as Array<{ name: string; properties?: Array<{ name: string }> }>;
    const clientOptionMembers = langGraphDocs
      .find((entry) => entry.name === 'LangGraphClientOptions')
      ?.properties?.map((property) => property.name);
    // A deployment key passed from Angular ships in the bundle, so the
    // adapter offers no field for one; a session token rides in headers.
    expect(clientOptionMembers).toContain('defaultHeaders');
    expect(clientOptionMembers).not.toContain('apiKey');
  });

  it('auto-rendered API pages resolve generated entries', () => {
    const unresolvedApiPages: string[] = [];

    for (const { library, section, slug } of getAllDocSlugs()) {
      if (section !== 'api') continue;
      const doc = getDocBySlug(library, section, slug);
      if (!doc?.content.includes('Auto-rendered from api-docs.json')) continue;

      const apiDocsPath = path.join(
        contentRoot,
        library,
        'api',
        'api-docs.json'
      );
      const entries = JSON.parse(
        fs.readFileSync(apiDocsPath, 'utf8')
      ) as Array<{ name: string }>;
      const names = new Set(entries.map((entry) => entry.name));

      // Group pages declare the exports they cover; every one must exist.
      const configured = findDocsPage(library, section, slug)?.apiEntries;
      if (configured) {
        const missing = configured.filter((name) => !names.has(name));
        if (missing.length > 0) {
          unresolvedApiPages.push(
            `${library}/api/${slug} → ${missing.join(', ')}`
          );
        }
        continue;
      }

      const pageTitle = doc.title.replace(/\(\)$/, '');
      if (!names.has(pageTitle) && !names.has(doc.title)) {
        unresolvedApiPages.push(`${library}/api/${slug}`);
      }
    }

    expect(unresolvedApiPages).toEqual([]);
  });

  it('returns null for non-existent doc', () => {
    expect(getDocBySlug('langgraph', 'guides', 'nonexistent')).toBeNull();
  });

  it('returns null for non-existent library', () => {
    expect(
      getDocBySlug('nonexistent', 'getting-started', 'introduction')
    ).toBeNull();
  });

  it('returns null metadata for non-existent docs', () => {
    expect(getDocMetadata('langgraph', 'guides', 'nonexistent')).toBeNull();
  });

  it('publishes a docs page for every capability the registry maps', () => {
    const configured = new Set(
      docsConfig.flatMap((library) =>
        library.sections.flatMap((section) =>
          section.pages.map(
            (page) => `/docs/${library.id}/${section.id}/${page.slug}`
          )
        )
      )
    );
    for (const entry of cockpitManifest) {
      if (entry.docsPath === NO_COCKPIT_DOCS_LINK) continue;
      expect(configured.has(entry.docsPath), entry.docsPath).toBe(true);
      // contentRoot already points at apps/website/content/docs, so strip the
      // leading /docs/ segment before joining.
      const file = path.join(
        contentRoot,
        `${entry.docsPath.replace(/^\/docs\//, '')}.mdx`
      );
      expect(fs.existsSync(file), file).toBe(true);
    }
  });
});

describe('docs breadcrumb routes', () => {
  // The docs BreadcrumbList and the shell header's visible `contextTrail` both
  // link the library rung through `libraryIntroPath()`. This pins the property that path
  // has to satisfy: it must be a real route, and the bare `/docs/<library>` it
  // stands in for must remain absent (there is no index route for it, so a crumb
  // pointing there would 404).
  it('resolves the library intro path to a real route for every library', () => {
    const routes = new Set(getSitemapRoutes());

    for (const library of docsConfig) {
      expect([library.id, routes.has(libraryIntroPath(library.id))]).toEqual([
        library.id,
        true,
      ]);
      expect([library.id, routes.has(`/docs/${library.id}`)]).toEqual([
        library.id,
        false,
      ]);
    }
  });
});

describe('retired telemetry docs library', () => {
  it('is absent from the docs configuration', () => {
    expect(docsConfig.map((library) => library.id)).not.toContain('telemetry');
  });

  it('contributes no route to the sitemap inventory', () => {
    expect(
      getSitemapRoutes().filter((route) => route.startsWith('/docs/telemetry'))
    ).toEqual([]);
  });

  it('contributes no searchable page', () => {
    const pages = docsConfig.flatMap((library) =>
      library.sections.flatMap((section) =>
        section.pages.map(
          (page) => `${library.id}/${page.section}/${page.slug}`
        )
      )
    );
    expect(pages.filter((page) => page.startsWith('telemetry/'))).toEqual([]);
  });
});
