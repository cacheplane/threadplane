import { expect, test } from 'vitest';
import { getWebsiteWorkspacePage } from './workspace-page';

test('resolves a React document to its native runtime and source assets', async () => {
  const page = await getWebsiteWorkspacePage({
    docsPath: '/docs/react/langgraph/guides/streaming',
    title: 'Streaming',
  });

  expect(page.presentation.kind).toBe('capability');
  if (page.presentation.kind !== 'capability') return;
  expect(page.presentation.docsPath).toBe('/docs/react/langgraph/guides/streaming');
  expect(page.presentation.codeAssetPaths).toContain('cockpit/langgraph/streaming/react/src/app.tsx');
  expect(page.presentation.runtimeUrl).toContain('langgraph/streaming/react');
  expect(page).not.toHaveProperty('frontendVariants');
});

test('keeps a React document readable without attaching an unrelated example', async () => {
  const page = await getWebsiteWorkspacePage({
    docsPath: '/docs/react/getting-started/quickstart',
    title: 'React quickstart',
  });

  expect(page.presentation).toMatchObject({ kind: 'docs-only', runnable: false });
  expect(page.contentBundle.runtimeUrl).toBeNull();
  expect(page).not.toHaveProperty('frontendVariants');
});

test('does not recognize retired narrative URLs as runnable documents', async () => {
  const page = await getWebsiteWorkspacePage({
    docsPath: '/docs/langgraph/guides/streaming',
    title: 'Retired',
  });

  expect(page.presentation.kind).toBe('docs-only');
});


test.each([
  ['/docs/angular/langgraph/guides/streaming', 'LangGraph Streaming'],
  ['/docs/angular/ag-ui/reference/event-mapping', 'AG-UI Streaming'],
])('preserves the established Angular runtime accessible title for %s', async (docsPath, title) => {
  const page = await getWebsiteWorkspacePage({ docsPath, title: 'Article title' });
  expect(page.resolution.kind).toBe('mapped');
  if (page.resolution.kind !== 'mapped') return;
  expect(page.resolution.identity.title).toBe(title);
});
