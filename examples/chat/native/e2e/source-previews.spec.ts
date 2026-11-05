import { test } from './fixtures';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';

test('installed source previews contain keyboard and pointer interaction without replacing composer or issuing commands', async ({
  page,
  retainedConsumer,
}, testInfo) => {
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { startCheckedServer } = await import('../tooling/retained-build.mjs');
  const a = threadEnvelope('a', 'Conversation A');
  const b = threadEnvelope('b', 'Conversation B');
  const title = ('<b>Literal source</b> ' + 'Long title '.repeat(12)).trimEnd();
  const url = 'https://example.com/' + 'long-path/'.repeat(30);
  const history = (thread: string) => ({
    method: 'POST',
    path: `/api/threads/${thread}/history`,
    payload: { limit: 10 },
    body: [
      {
        values: {
          messages: [
            {
              id: 'answer',
              type: 'ai',
              content: 'Answer with sources',
              additional_kwargs: {
                citations: [
                  {
                    id: 'safe',
                    index: 1,
                    title,
                    url,
                    snippet:
                      '<script>literal()</script>\n' + 'Unbroken'.repeat(60),
                    sourceType: 'Authored',
                    publishedAt: 'supplied date',
                    iconUrl: 'https://images.invalid/never-fetch',
                  },
                  {
                    id: 'blocked',
                    index: 2,
                    title: 'Blocked source',
                    url: 'javascript:alert(1)',
                  },
                ],
              },
            },
          ],
        },
        next: [],
        tasks: [],
        checkpoint: {
          thread_id: thread,
          checkpoint_ns: '',
          checkpoint_id: 'saved',
        },
        parent_checkpoint: null,
        metadata: null,
        created_at: '2026-09-30T00:00:00.000Z',
      },
    ],
  });
  const backend = await startProofServer([
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [a, b],
    },
    { method: 'GET', path: '/api/threads/a', body: a },
    history('a'),
    { method: 'GET', path: '/api/threads/b', body: b },
    history('b'),
    { method: 'GET', path: '/api/threads/a', body: a },
    history('a'),
  ]);
  let server: Awaited<ReturnType<typeof startCheckedServer>> | undefined;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    server = await startCheckedServer({
      retained: retainedConsumer,
      target: backend.origin + '/api',
    });
    const origin = server.url;
    await page.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === origin)
        return route.continue();
      errors.push(`Unexpected external request: ${route.request().url()}`);
      return route.abort();
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(origin + '/?thread=a');
    const draft = page.getByLabel('Message', { exact: true });
    await expect(draft).toBeEnabled();
    await draft.fill('Preserve this draft');
    const textarea = await draft.elementHandle();
    assert.ok(textarea);
    const sources = page.getByRole('button', {
      name: 'Sources (2)',
      exact: true,
    });
    await expect(sources).toHaveAttribute('aria-expanded', 'false');
    await sources.click();
    const trigger = page.getByRole('button', {
      name: `Preview source 1: ${title}`,
      exact: true,
    });
    const blocked = page.getByRole('button', {
      name: 'Preview source 2: Blocked source',
      exact: true,
    });
    const dialog = page.getByRole('dialog', { name: 'Source 1', exact: true });
    const close = dialog.getByRole('button', { name: 'Close', exact: true });
    const link = dialog.getByRole('link', { name: 'Open source', exact: true });
    const retained = async (count: number) => {
      expect(backend.requests).toHaveLength(count);
      await expect(draft).toHaveValue('Preserve this draft');
      expect(
        await textarea.evaluate(
          (node) => node === document.querySelector('#message')
        )
      ).toBe(true);
    };
    await trigger.focus();
    await expect(dialog).toHaveCount(0);
    await page.keyboard.press('Control+Enter');
    await expect(dialog).toHaveCount(0);
    await retained(3);
    await page.keyboard.press('Enter');
    await expect(close).toBeFocused();
    await expect(dialog).toContainText('<script>literal()</script>');
    await expect(dialog.locator('img,script,b')).toHaveCount(0);
    await expect(link).toHaveAttribute('href', url);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await page.keyboard.press('Tab');
    await expect(link).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(link).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await retained(3);
    await page.keyboard.press('Space');
    await expect(close).toBeFocused();
    await dialog.locator('h2').click();
    await expect(dialog).toBeVisible();
    await close.click();
    await expect(trigger).toBeFocused();
    await retained(3);
    await blocked.click();
    const blockedDialog = page.getByRole('dialog', {
      name: 'Source 2',
      exact: true,
    });
    await expect(blockedDialog).toContainText('javascript:alert(1)');
    await expect(blockedDialog.getByRole('link')).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(
      blockedDialog.getByRole('button', { name: 'Close', exact: true })
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await retained(3);
    // Portal direction and long literal strings stay within both small viewports.
    await page
      .locator('html')
      .evaluate((node) => node.setAttribute('dir', 'rtl'));
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await trigger.click();
      await expect(dialog).toHaveAttribute('dir', 'rtl');
      const box = await dialog.boundingBox();
      assert.ok(box);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(844);
      expect(
        await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)
      ).toBe(true);
      const closeBox = await close.boundingBox();
      assert.ok(closeBox);
      expect(closeBox.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({
        path: testInfo.outputPath(`source-preview-rtl-${width}.png`),
      });
      await page.keyboard.press('Escape');
      await retained(3);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page
      .locator('html')
      .evaluate((node) => node.setAttribute('dir', 'ltr'));
    await trigger.click();
    const bounds = await dialog.boundingBox();
    assert.ok(bounds);
    await page.mouse.click(
      Math.max(1, bounds.x - 10),
      Math.max(1, bounds.y - 10)
    );
    await expect(dialog).toHaveCount(0);
    await retained(3);
    await trigger.click();
    const oldDialog = await dialog.elementHandle();
    assert.ok(oldDialog);
    const oldTrigger = await trigger.elementHandle();
    assert.ok(oldTrigger);
    // Browser navigation can change selection while the native modal is open.
    const select = async (thread: string) =>
      page.evaluate((thread) => {
        const next = new URL(location.href);
        next.searchParams.set('thread', thread);
        history.pushState(null, '', next);
        dispatchEvent(new PopStateEvent('popstate'));
      }, thread);
    await select('b');
    await backend.steps[4].received;
    await expect(page.locator('.conversation-id')).toHaveText(
      'Conversation ID: b'
    );
    await expect(page.getByRole('dialog', { name: /^Source / })).toHaveCount(0);
    expect(await oldDialog.evaluate((node) => node.isConnected)).toBe(false);
    await select('a');
    await backend.steps[6].received;
    await expect(sources).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toHaveCount(0);
    await sources.click();
    await expect(trigger).toBeVisible();
    await expect(page.getByRole('dialog', { name: /^Source / })).toHaveCount(0);
    expect(await oldTrigger.evaluate((node) => node.isConnected)).toBe(false);
    await oldTrigger.evaluate((node) => (node as HTMLButtonElement).click());
    await expect(page.getByRole('dialog', { name: /^Source / })).toHaveCount(0);
    expect(backend.requests).toHaveLength(7);
    backend.verify();
    for (const step of backend.steps)
      expect((await step.closed).finished).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await server?.close();
    await backend.close();
  }
});
