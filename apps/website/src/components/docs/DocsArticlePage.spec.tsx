import { isValidElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { DocsArticlePage } from './DocsArticlePage';
import { MdxRenderer } from './MdxRenderer';
import { DocsTOC } from './DocsTOC';
import { DocsPageHeader } from './DocsPageHeader';
import { PageActions } from './PageActions';
import { WebsiteWorkspace } from '../workspace/WebsiteWorkspace';
import { getNarrativeDocuments } from '../../lib/docs-catalog';
import { getDocMetadataByPath } from '../../lib/docs';

function find(node: ReactNode, type: unknown): any {
  if (Array.isArray(node)) return node.map(child => find(child, type)).find(Boolean);
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  return node.type === type ? node : find(node.props.children, type);
}

describe('canonical documentation articles', () => {
  it.each(['angular', 'react'] as const)('selects only %s article, metadata, and source assets', async framework => {
    const pathname = `/docs/${framework}/langgraph/guides/streaming`;
    const tree = await DocsArticlePage({ pathname });
    const workspace = find(tree, WebsiteWorkspace);
    const mdx = find(workspace.props.docsSlot, MdxRenderer);
    expect(workspace.props.framework).toBe(framework);
    expect(workspace.props.frontendVariants).toBeUndefined();
    expect(mdx.props.docsPath).toBe(pathname);
    expect(mdx.props.exampleCode.assetPaths.some((path: string) => path.includes(`/streaming/${framework}/`))).toBe(true);
    const actions = find(find(workspace.props.docsSlot, DocsPageHeader).props.actions, PageActions);
    expect(actions.props.documentPath).toBe(`${framework}/langgraph/guides/streaming`);
    expect(actions.props.source).toBe(`${framework}/langgraph/guides/streaming.mdx`);
    const metadata = getDocMetadataByPath(pathname);
    expect(metadata?.alternates?.canonical).toContain(pathname);
    expect(find(workspace.props.docsSlot, DocsTOC).props.headings.length).toBeGreaterThan(0);
  });
  it('renders shared middleware without a framework runtime', async () => {
    const tree = await DocsArticlePage({ pathname: '/docs/shared/middleware/getting-started/introduction' });
    const workspace = find(tree, WebsiteWorkspace);
    expect(workspace.props.presentation.kind).toBe('docs-only');
    expect(workspace.props.presentation.runtimeUrl).toBeUndefined();
  });
  it.each(['/docs/langgraph/guides/streaming', '/docs/vue/langgraph/guides/streaming', '/docs/react/langgraph/concepts/angular-signals'])('404s unavailable identity %s', async pathname => {
    await expect(DocsArticlePage({ pathname })).rejects.toThrow();
  });
  it.each(getNarrativeDocuments('react'))('resolves $href with its declared source context', async doc => {
    const tree = await DocsArticlePage({ pathname: doc.href });
    const workspace = find(tree, WebsiteWorkspace);
    const mdx = find(workspace.props.docsSlot, MdxRenderer);
    expect(mdx.props.source).toBeTruthy();
    for (const match of mdx.props.source.matchAll(/<ExampleCode[^>]*\bfile="([^"]+)"/g)) {
      expect(mdx.props.exampleCode?.assetPaths, doc.href).toContain(match[1]);
      expect(mdx.props.exampleCode?.sources[match[1]], doc.href).toBeTruthy();
    }
  });
});
