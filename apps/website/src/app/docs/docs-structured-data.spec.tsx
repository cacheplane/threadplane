import { describe, expect, it } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import DocsPage, { generateMetadata } from './[library]/[section]/[slug]/page';
import { docsConfig } from '../../lib/docs-config';
import { getSitemapRoutes } from '../../lib/site-metadata';

interface Slug {
  library: string;
  section: string;
  slug: string;
}

/**
 * A spread of shapes rather than every page: one per description source
 * (frontmatter, first-paragraph fallback), a moved walkthrough, and a page that is
 * itself the library's breadcrumb target.
 */
const SAMPLES: Slug[] = [
  { library: 'langgraph', section: 'guides', slug: 'streaming' },
  { library: 'langgraph', section: 'getting-started', slug: 'introduction' },
  { library: 'render', section: 'guides', slug: 'element-rendering' },
  { library: 'chat', section: 'getting-started', slug: 'introduction' },
  { library: 'a2ui', section: 'getting-started', slug: 'introduction' },
];

/** Every `data` payload the page hands to a `<JsonLd>`, in render order. */
async function renderedJsonLd({ library, section, slug }: Slug): Promise<Record<string, unknown>[]> {
  const tree = await DocsPage({ params: Promise.resolve({ library, section, slug }) });
  const found: Record<string, unknown>[] = [];

  const walk = (node: ReactNode): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!isValidElement(node)) return;
    const props = node.props as { data?: Record<string, unknown>; children?: ReactNode };
    // Matched by name because `JsonLd` is a plain function component; importing
    // it for identity would still work, but the name keeps the failure legible.
    if (typeof node.type === 'function' && (node.type as { name?: string }).name === 'JsonLd' && props.data) {
      found.push(props.data);
    }
    walk(props.children);
  };

  walk(tree);
  return found;
}

function nodeOfType(nodes: Record<string, unknown>[], type: string): Record<string, unknown> | undefined {
  return nodes.find((node) => node['@type'] === type);
}

function findWorkspaceContextTrail(
  node: ReactNode
): { label: string; href?: string }[] | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findWorkspaceContextTrail(child);
      if (found) return found;
    }
    return undefined;
  }
  if (!isValidElement(node)) return undefined;
  const props = node.props as {
    contextTrail?: { label: string; href?: string }[];
    children?: ReactNode;
  };
  if (props.contextTrail) return props.contextTrail;
  return findWorkspaceContextTrail(props.children);
}

describe('docs page structured data', () => {
  // The tautology this replaces compared `resolveDocDescription` against
  // `getDocMetadata`, which calls it — both sides were the same function. The
  // real risk is the *page* describing itself differently from its own
  // `generateMetadata`, so the assertion runs over both actual surfaces.
  it('describes itself with the same string its metadata publishes', async () => {
    for (const sample of SAMPLES) {
      const [article, metadata] = await Promise.all([
        renderedJsonLd(sample).then((nodes) => nodeOfType(nodes, 'TechArticle')),
        generateMetadata({ params: Promise.resolve(sample) }),
      ]);

      const label = `${sample.library}/${sample.section}/${sample.slug}`;
      expect([label, typeof metadata.description]).toEqual([label, 'string']);
      expect([label, article?.description]).toEqual([label, metadata.description]);
    }
  });

  it('emits exactly a TechArticle and a BreadcrumbList', async () => {
    const nodes = await renderedJsonLd(SAMPLES[0]);
    expect(nodes.map((node) => node['@type'])).toEqual(['TechArticle', 'BreadcrumbList']);
  });

  it('links the same library URL the visible trail links', async () => {
    for (const sample of SAMPLES) {
      const tree = await DocsPage({ params: Promise.resolve(sample) });
      const nodes = await renderedJsonLd(sample);
      const crumbs = nodeOfType(nodes, 'BreadcrumbList')?.itemListElement as
        | { name: string; item: string }[]
        | undefined;

      // The trail the shell header renders, taken from the route itself, so
      // this cannot pass by agreeing with a component the route dropped.
      const trail = findWorkspaceContextTrail(tree);
      const libraryTitle = docsConfig.find((lib) => lib.id === sample.library)?.title ?? '';
      const visibleHref = trail?.find((crumb) => crumb.label === libraryTitle)?.href;

      const label = `${sample.library}/${sample.section}/${sample.slug}`;
      expect([label, crumbs?.find((crumb) => crumb.name === libraryTitle)?.item]).toEqual([
        label,
        `https://threadplane.ai${visibleHref}`,
      ]);
    }
  });

  // A non-final BreadcrumbList item pointing at a 404 is a defect, and the
  // plan's original `/docs/<library>` was exactly that. Rendering the page is
  // what gives this teeth: reverting the URL in page.tsx fails here.
  it('points every non-final breadcrumb rung at a route that exists', async () => {
    const routes = new Set(getSitemapRoutes().map((route) => `https://threadplane.ai${route === '/' ? '/' : route}`));

    for (const sample of SAMPLES) {
      const nodes = await renderedJsonLd(sample);
      const crumbs = nodeOfType(nodes, 'BreadcrumbList')?.itemListElement as { item: string }[];
      const missing = crumbs.slice(0, -1).map((crumb) => crumb.item).filter((item) => !routes.has(item));
      expect([`${sample.library}/${sample.section}/${sample.slug}`, missing]).toEqual([
        `${sample.library}/${sample.section}/${sample.slug}`,
        [],
      ]);
    }
  });
});
