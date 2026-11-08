import { expect, test } from '@playwright/test';

// Website-only checks. No message submissions or runtime services are needed.
test('search limits default results to the selected framework and shared material', async ({ request }) => {
  for (const framework of ['angular', 'react']) {
    const response = await request.get(`/api/docs-search?q=streaming&framework=${framework}`);
    expect(response.ok()).toBe(true);
    const { results } = await response.json();
    expect(results.length).toBeGreaterThan(0);
    for (const hit of results) {
      expect([framework, 'shared', undefined]).toContain(hit.scope);
      expect(hit.href).not.toMatch(framework === 'react' ? /^\/docs\/angular\// : /^\/docs\/react\//);
      expect(hit.href).not.toContain('frontend=');
    }
  }
  const broader = await request.get('/api/docs-search?q=streaming&framework=react&allFrameworks=true');
  const { results } = await broader.json();
  expect(results.some((hit: { scope: string }) => hit.scope === 'angular')).toBe(true);
  expect(results.some((hit: { scope: string }) => hit.scope === 'react')).toBe(true);
});

test('the React search dialog labels broader results and opens the canonical React topic', async ({ page }) => {
  await page.goto('/docs/react/getting-started/introduction');
  await page.getByRole('button', { name: 'Search docs', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Search documentation' });
  await dialog.getByRole('combobox', { name: 'Search documentation...' }).fill('streaming');
  const labels = dialog.locator('.docs-search-result-lib');
  await expect(labels.filter({ hasText: 'React' }).first()).toBeVisible();
  await expect(labels.filter({ hasText: 'Angular' })).toHaveCount(0);
  await dialog.getByRole('checkbox', { name: 'Search all frameworks' }).check();
  await expect(labels.filter({ hasText: 'Angular' }).first()).toBeVisible();
  const reactStreaming = dialog.getByRole('option').filter({ hasText: 'LangGraph · React' })
    .filter({ has: page.locator('.docs-search-result-title', { hasText: /^Streaming$/ }) }).first();
  await reactStreaming.click();
  await expect(page).toHaveURL('/docs/react/langgraph/guides/streaming');
  await expect(page.getByRole('heading', { name: 'React streaming preview', exact: true })).toBeVisible();
});

test('Markdown exports and sitemap retain each document canonical framework', async ({ request }) => {
  const react = await request.get('/api/markdown/react/langgraph/guides/streaming');
  expect(react.ok()).toBe(true);
  const markdown = await react.text();
  expect(markdown).toContain('# React streaming preview');
  expect(markdown).toContain('experimental, private source-build packages');
  expect(markdown).toContain('/docs/react/langgraph/concepts/conversation-turns');
  expect(markdown).not.toContain('/docs/angular/langgraph/concepts/conversation-turns');
  const angular = await request.get('/api/markdown/angular/langgraph/guides/streaming');
  expect(angular.ok()).toBe(true);
  expect(await angular.text()).toContain('# Streaming');
  expect(await angular.text()).not.toContain('# React streaming preview');
  const missing = await request.get('/api/markdown/react/langgraph/concepts/angular-signals');
  expect(missing.status()).toBe(404);
  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.ok()).toBe(true);
  const xml = await sitemap.text();
  expect(xml).toContain('/docs/react/langgraph/guides/streaming</loc>');
  expect(xml).toContain('/docs/angular/langgraph/guides/streaming</loc>');
  expect(xml).toContain('/docs/shared/middleware/getting-started/introduction</loc>');
  expect(xml).not.toContain('/docs/langgraph/guides/streaming</loc>');
  expect(xml).not.toContain('frontend=');
});

test('new React onboarding and component guides appear in search and Markdown exports', async ({ request }) => {
  for (const [query, href] of [
    ['Prepare a React source build', '/docs/react/langgraph/getting-started/installation'],
    ['Prepare React chat', '/docs/react/chat/getting-started/installation'],
  ]) {
    const response = await request.get(`/api/docs-search?q=${encodeURIComponent(query)}&framework=react`);
    expect(response.ok()).toBe(true);
    const { results } = await response.json();
    expect(results.map((hit: { href: string }) => hit.href)).toContain(href);
  }
  for (const [id, heading] of [
    ['langgraph/getting-started/installation', 'Prepare a React source build'],
    ['langgraph/concepts/conversation-turns', 'Follow a React conversation'],
    ['chat/components/chat-popup', 'ChatPopup'],
    ['ag-ui/getting-started/quickstart', 'Start with AG-UI streaming'],
    ['render/getting-started/quickstart', 'Render your first specification'],
  ]) {
    const exported = await request.get(`/api/markdown/react/${id}`);
    expect(exported.ok(), id).toBe(true);
    const text = await exported.text();
    expect(text, id).toContain(`# ${heading}`);
    expect(text, id).toMatch(/private.*source.build/i);
    expect(text, id).not.toContain('/docs/angular/langgraph/concepts/conversation-turns');
  }
  const xml = await (await request.get('/sitemap.xml')).text();
  expect(xml).toContain('/docs/react/langgraph/getting-started/installation</loc>');
  expect(xml).toContain('/docs/react/chat/components/chat-popup</loc>');
});
