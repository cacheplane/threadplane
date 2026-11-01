import { describe, expect, it } from 'vitest';
import { cockpitManifest } from './manifest';
import {
  getCanonicalWebsiteWorkspaceHref,
  getWorkspaceDestinationPath,
  getRouteDefaultMode,
  resolveDocsWorkspace,
} from './workspace-resolution';

describe('workspace identity resolution', () => {
  it('assigns a unique stable ID to every manifest entry', () => {
    const ids = cockpitManifest.map((entry) => entry.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of cockpitManifest) {
      expect(entry.id).toBe(
        `${entry.product}:${entry.section}:${entry.topic}:${entry.page}:${entry.language}`
      );
    }
  });

  it('round-trips unique canonical Docs paths', () => {
    const publishedEntries = cockpitManifest.filter(
      (entry) => entry.docsPath.length > 0
    );
    const counts = new Map<string, number>();
    for (const entry of publishedEntries) {
      counts.set(entry.docsPath, (counts.get(entry.docsPath) ?? 0) + 1);
    }

    for (const entry of publishedEntries.filter(
      (candidate) => counts.get(candidate.docsPath) === 1
    )) {
      expect(resolveDocsWorkspace(entry.docsPath, entry.title)).toMatchObject({
        kind: 'mapped',
        identity: { id: entry.id, docsPath: entry.docsPath },
      });
    }
  });

  it('gives every manifest entry a unique docs path so no override table is needed', () => {
    const seen = new Map<string, string>();
    for (const entry of cockpitManifest) {
      expect(entry.docsPath, entry.id).not.toBe('');
      const previous = seen.get(entry.docsPath);
      expect(
        previous,
        `${entry.id} shares ${entry.docsPath} with ${previous}`
      ).toBeUndefined();
      seen.set(entry.docsPath, entry.id);
    }
    expect(
      resolveDocsWorkspace(
        '/docs/langgraph/guides/durable-execution',
        'Durable Execution'
      )
    ).toMatchObject({
      kind: 'mapped',
      identity: {
        id: 'langgraph:core-capabilities:durable-execution:overview:python',
      },
    });
    expect(
      getWorkspaceDestinationPath({
        id: 'langgraph:core-capabilities:durable-execution:overview:python',
        docsPath: '/docs/langgraph/guides/durable-execution',
      })
    ).toBe('/docs/langgraph/guides/durable-execution');
  });

  it('returns a discriminated docs-only resolution for an unmapped valid Docs page', () => {
    expect(
      resolveDocsWorkspace(
        '/docs/api/langgraph/injectAgent',
        'Inject an agent into Angular'
      )
    ).toEqual({
      kind: 'docs-only',
      docsPath: '/docs/api/langgraph/injectAgent',
      title: 'Inject an agent into Angular',
      unavailableReason: 'no-workspace-capability',
    });
  });

  it('defaults every route to Docs', () => {
    const mappedDocs = resolveDocsWorkspace(
      '/docs/langgraph/guides/streaming',
      'Streaming'
    );
    const docsOnly = resolveDocsWorkspace(
      '/docs/api/langgraph/injectAgent',
      'Inject an agent into Angular'
    );
    expect(getRouteDefaultMode(mappedDocs)).toBe('Docs');
    expect(getRouteDefaultMode(docsOnly)).toBe('Docs');
  });

  it('never fuzzy-matches Docs slugs', () => {
    expect(
      resolveDocsWorkspace('/docs/langgraph/guides/stream', 'Stream')
    ).toMatchObject({ kind: 'docs-only' });
  });
});

describe('canonical Website workspace destinations', () => {
  it('omits Docs mode on every canonical Docs path', () => {
    const primary = resolveDocsWorkspace(
      '/docs/langgraph/guides/persistence',
      'Persistence'
    );
    const secondary = resolveDocsWorkspace(
      '/docs/langgraph/guides/durable-execution',
      'Durable Execution'
    );

    expect(getCanonicalWebsiteWorkspaceHref(primary, 'Docs')).toBe(
      '/docs/langgraph/guides/persistence'
    );
    expect(getCanonicalWebsiteWorkspaceHref(secondary, 'Docs')).toBe(
      '/docs/langgraph/guides/durable-execution'
    );
    expect(getCanonicalWebsiteWorkspaceHref(secondary, 'Run')).toBe(
      '/docs/langgraph/guides/durable-execution?mode=run'
    );
    expect(getCanonicalWebsiteWorkspaceHref(primary, 'Code')).toBe(
      '/docs/langgraph/guides/persistence?mode=code'
    );
  });

  it('serializes docs-only resolutions without accepting source query data', () => {
    const resolution = resolveDocsWorkspace(
      '/docs/api/langgraph/injectAgent',
      'Inject an agent into Angular'
    );

    expect(getCanonicalWebsiteWorkspaceHref(resolution, 'Docs')).toBe(
      '/docs/api/langgraph/injectAgent'
    );
    expect(getCanonicalWebsiteWorkspaceHref(resolution, 'Run')).toBe(
      '/docs/api/langgraph/injectAgent?mode=run'
    );
  });
});
