import { describe, expect, it } from 'vitest';
import { resolveDocsWorkspace } from '@threadplane/cockpit-registry';
import { getWorkspacePresentation } from './workspace-presentation';

describe('frontend-specific workspace presentation', () => {
  it('selects the React runtime and code as one variant', () => {
    const resolution = resolveDocsWorkspace(
      '/docs/langgraph/guides/streaming',
      'Streaming'
    );
    expect(getWorkspacePresentation(resolution, 'react')).toMatchObject({
      kind: 'capability',
      runtimeUrl: 'langgraph/streaming/react',
      codeAssetPaths: expect.arrayContaining([
        'cockpit/langgraph/streaming/react/src/app.tsx',
      ]),
      runnable: true,
    });
    expect(getWorkspacePresentation(resolution)).toMatchObject({
      runtimeUrl: 'langgraph/streaming',
    });
  });

  it('does not lend an Angular runtime to an unsupported React topic', () => {
    const resolution = resolveDocsWorkspace(
      '/docs/langgraph/guides/persistence',
      'Persistence'
    );
    expect(getWorkspacePresentation(resolution, 'react')).toMatchObject({
      kind: 'docs-only',
      runnable: false,
    });
  });
});
