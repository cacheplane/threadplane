import { test } from './fixtures';
import { expect } from '@playwright/test';

for (const presentation of ['page', 'sidenav'] as const) {
  test(`installed React ${presentation} searches loaded titles in a modal without changing the conversation`, async ({
    page,
    retainedConsumer,
  }, testInfo) => {
    const { startProofServer, threadEnvelope } = await import(
      '../tooling/proof-server.mjs'
    );
    const { startCheckedServer } = await import(
      '../tooling/retained-build.mjs'
    );
    const rows = [
      {
        ...threadEnvelope('a', 'Alpha notes'),
        metadata: { title: 'Alpha notes', projectId: 'one' },
      },
      {
        ...threadEnvelope('b', '<Beta> & archived'),
        metadata: {
          title: '<Beta> & archived',
          projectId: 'two',
          archived: true,
        },
      },
      threadEnvelope('c', 'Gamma notes'),
    ];
    const history = (id: string) => ({
      method: 'POST',
      path: `/api/threads/${id}/history`,
      payload: { limit: 10 },
      body: [],
    });
    const backend = await startProofServer([
      {
        method: 'POST',
        path: '/api/threads/search',
        payload: { limit: 50, offset: 0 },
        body: rows,
      },
      { method: 'GET', path: '/api/threads/a', body: rows[0] },
      history('a'),
      { method: 'GET', path: '/api/threads/b', body: rows[1] },
      history('b'),
    ]);
    let server: Awaited<ReturnType<typeof startCheckedServer>> | undefined;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      server = await startCheckedServer({
        retained: retainedConsumer,
        target: backend.origin + '/api',
        apiKey: 'loaded-search-proof-key',
      });
      const origin = server.url;
      await page.route('**/*', (route) => {
        if (new URL(route.request().url()).origin === origin) {
          expect(route.request().headers()['x-api-key']).toBeUndefined();
          return route.continue();
        }
        errors.push('Unexpected external request');
        return route.abort();
      });
      await page.setViewportSize({
        width: presentation === 'page' ? 390 : 1280,
        height: 844,
      });
      await page.goto(origin + `/?presentation=${presentation}&thread=a`);
      const filter = page.getByRole('searchbox', {
        name: 'Filter loaded conversations by title',
        exact: true,
      });
      const draft = page.getByRole('textbox', { name: 'Message', exact: true });
      await expect(draft).toBeVisible();
      await filter.fill('Alpha');
      await draft.fill('Keep this draft.');
      const retainedDraft = await draft.elementHandle();
      expect(retainedDraft).not.toBeNull();
      const before = page.url();
      const search = page.getByRole('button', {
        name: 'Search loaded conversations',
        exact: true,
      });
      const palette = page.getByRole('dialog', {
        name: 'Search loaded conversations',
        exact: true,
      });
      const input = palette.getByRole('combobox');
      const close = palette.getByRole('button', {
        name: 'Close search',
        exact: true,
      });
      const assertRetained = async () => {
        await expect(filter).toHaveValue('Alpha');
        await expect(draft).toHaveValue('Keep this draft.');
        expect(
          await retainedDraft?.evaluate(
            (node) => node === document.querySelector('#message')
          )
        ).toBe(true);
        expect(page.url()).toBe(before);
        expect(backend.requests).toHaveLength(3);
      };
      await search.click();
      await expect(input).toBeFocused();
      expect(await palette.evaluate((node) => node.matches(':modal'))).toBe(
        true
      );
      await expect(palette.getByRole('option')).toHaveCount(3);
      await expect(palette.getByRole('option').nth(1)).toContainText(
        '<Beta> & archived'
      );
      expect(await palette.locator('beta').count()).toBe(0);
      await expect(palette).toContainText(
        'up to 50 loaded conversations across all projects, including archived'
      );
      await draft.evaluate((node) => node.focus());
      await expect(input).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(close).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(input).toBeFocused();
      await input.fill('no such loaded title');
      await expect(palette.getByRole('option')).toHaveCount(0);
      await expect(input).not.toHaveAttribute('aria-activedescendant');
      await page.keyboard.press('Enter');
      await expect(palette).toBeVisible();
      await input.fill('beta');
      await expect(palette.getByRole('option')).toHaveCount(1);
      // Composition is tracked independently of the per-key isComposing flag.
      await input.dispatchEvent('compositionstart');
      await page.keyboard.press('Enter');
      await expect(palette).toBeVisible();
      await input.dispatchEvent('compositionend');
      await page.keyboard.press('Escape');
      await expect(palette).toHaveCount(0);
      await expect(search).toBeFocused();
      await assertRetained();
      await search.click();
      await expect(input).toHaveValue('');
      await close.focus();
      await page.keyboard.press('Space');
      await expect(palette).toHaveCount(0);
      await assertRetained();
      await search.click();
      const box = await palette.boundingBox();
      expect(box).not.toBeNull();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
        page.viewportSize()?.width ?? 0
      );
      await page.screenshot({
        path: testInfo.outputPath(`search-${presentation}.png`),
        fullPage: true,
      });
      await page.mouse.click(1, 1);
      await expect(palette).toHaveCount(0);
      await assertRetained();
      await search.click();
      await input.fill('Beta');
      if (presentation === 'page') await page.keyboard.press('Enter');
      else await palette.getByRole('option').click();
      await expect(palette).toHaveCount(0);
      await expect(page).toHaveURL(/thread=b/);
      await expect(filter).toHaveValue('');
      await expect(
        page.getByRole('button', { name: '<Beta> & archived', exact: true })
      ).toHaveAttribute('aria-current', 'true');
      await expect(draft).toHaveValue('');
      await expect.poll(() => backend.requests.length).toBe(5);
      backend.verify();
      for (const request of backend.requests)
        expect(request.headers['x-api-key']).toBe('loaded-search-proof-key');
      expect(errors).toEqual([]);
    } finally {
      await page.close();
      await server?.close();
      await backend.close();
    }
  });
}
