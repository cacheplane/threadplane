import { test } from './fixtures';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';

test.use({ hasTouch: true });

test('installed Sources disclosure keeps native activation, previews, and local state within its mounted message', async ({
  page,
  retainedConsumer,
}, testInfo) => {
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { startCheckedServer } = await import('../tooling/retained-build.mjs');
  const thread = threadEnvelope('a', 'Conversation A');
  const title = '<b>Literal source</b> ' + 'LongTitle'.repeat(24);
  const url = 'https://example.com/' + 'long-path/'.repeat(30);
  const backend = await startProofServer([
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [thread],
    },
    { method: 'GET', path: '/api/threads/a', body: thread },
    {
      method: 'POST',
      path: '/api/threads/a/history',
      payload: { limit: 10 },
      body: [
        {
          values: {
            messages: [
              {
                id: 'answer',
                type: 'ai',
                content: 'Answer with supplied sources',
                additional_kwargs: {
                  citations: [
                    {
                      id: 'safe',
                      index: 1,
                      title,
                      url,
                      snippet:
                        '<script>literal()</script> ' + 'Long'.repeat(80),
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
            thread_id: 'a',
            checkpoint_ns: '',
            checkpoint_id: 'saved',
          },
          parent_checkpoint: null,
          metadata: null,
          created_at: '2026-09-30T00:00:00.000Z',
        },
      ],
    },
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
    await draft.fill('Preserve disclosure draft');
    const textarea = await draft.elementHandle();
    assert.ok(textarea);
    const panel = page.getByRole('region', { name: 'Sources', exact: true });
    const header = panel.getByRole('button', {
      name: 'Sources (2)',
      exact: true,
    });
    await expect(header).toHaveAttribute('type', 'button');
    const controls = await header.getAttribute('aria-controls');
    assert.ok(controls);
    const body = page.locator(`[id=${JSON.stringify(controls)}]`);
    const preview = panel.getByRole('button', {
      name: `Preview source 1: ${title}`,
      exact: true,
    });
    const retained = async () => {
      expect(backend.requests).toHaveLength(3);
      await expect(draft).toHaveValue('Preserve disclosure draft');
      expect(
        await textarea.evaluate(
          (node) => node === document.querySelector('#message')
        )
      ).toBe(true);
      await expect(header).toHaveAttribute('aria-controls', controls);
    };
    const collapsed = async () => {
      await expect(header).toHaveAttribute('aria-expanded', 'false');
      await expect(body).toHaveCount(1);
      await expect(body).toBeHidden();
      await expect(body.locator('button,a,input,[tabindex]')).toHaveCount(0);
      await expect(panel.getByRole('listitem')).toHaveCount(0);
      await expect(page.getByRole('dialog', { name: /^Source / })).toHaveCount(
        0
      );
      await retained();
    };
    await collapsed();
    await header.focus();
    for (const key of ['Control+Enter', 'Shift+Space']) {
      await page.keyboard.press(key);
      await collapsed();
    }
    await page.keyboard.press('Enter');
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await expect(panel.getByRole('listitem')).toHaveCount(2);
    await expect(preview).toBeVisible();
    await retained();
    await page.keyboard.press('Space');
    await collapsed();
    await expect(header).toBeFocused();
    await header.click();
    await preview.click();
    const dialog = page.getByRole('dialog', { name: 'Source 1', exact: true });
    const close = dialog.getByRole('button', { name: 'Close', exact: true });
    const link = dialog.getByRole('link', { name: 'Open source', exact: true });
    await expect(close).toBeFocused();
    await expect(link).toHaveAttribute('href', url);
    await expect(dialog).toContainText('<script>literal()</script>');
    await expect(dialog.locator('img,script,b')).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(link).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(preview).toBeFocused();
    const retiredPreview = await preview.elementHandle();
    assert.ok(retiredPreview);
    await header.click();
    await collapsed();
    expect(await retiredPreview.evaluate((node) => node.isConnected)).toBe(
      false
    );
    await retiredPreview.evaluate((node) =>
      (node as HTMLButtonElement).click()
    );
    await collapsed();
    await header.tap();
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await panel
      .getByRole('button', {
        name: 'Preview source 2: Blocked source',
        exact: true,
      })
      .tap();
    const blockedDialog = page.getByRole('dialog', {
      name: 'Source 2',
      exact: true,
    });
    await expect(blockedDialog).toContainText('javascript:alert(1)');
    await expect(blockedDialog.getByRole('link')).toHaveCount(0);
    await blockedDialog
      .getByRole('button', { name: 'Close', exact: true })
      .tap();
    await header.tap();
    await collapsed();
    // Exercise the real disclosure in RTL at both phone widths.
    await page
      .locator('html')
      .evaluate((node) => node.setAttribute('dir', 'rtl'));
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await header.tap();
      await expect(preview).toBeVisible();
      await header.scrollIntoViewIfNeeded();
      const bounds = await panel.boundingBox();
      const target = await header.boundingBox();
      assert.ok(bounds && target);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(target.height).toBeGreaterThanOrEqual(44);
      expect(
        await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`citation-disclosure-rtl-${width}.png`),
      });
      await header.tap();
      await collapsed();
    }
    // Theme only the message scope so token inheritance is visible in the proof.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page
      .locator('html')
      .evaluate((node) => node.setAttribute('dir', 'ltr'));
    await panel.evaluate((node) => {
      node.style.setProperty('--tp-chat-color-scheme', 'dark');
      node.style.setProperty('--tp-chat-text', '#f5f5f5');
      node.style.setProperty('--tp-chat-muted', '#b5b5b5');
      node.style.setProperty('--tp-chat-surface', '#1c1c1c');
      node.style.setProperty('--tp-chat-border', '#454545');
      node.style.setProperty('--tp-chat-accent', '#f5f5f5');
    });
    await header.click();
    await draft.hover();
    await expect(header).toHaveCSS('color', 'rgb(245, 245, 245)');
    await expect(header).toHaveCSS('background-color', 'rgb(28, 28, 28)');
    await header.hover();
    await expect(header).toHaveCSS('color', 'rgb(245, 245, 245)');
    await expect(header).toHaveCSS('background-color', 'rgb(28, 28, 28)');
    await expect(header).toHaveCSS('border-color', 'rgb(69, 69, 69)');
    await draft.hover();
    await header.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(header).toBeFocused();
    expect(
      await header.evaluate((node) => node.matches(':focus-visible'))
    ).toBe(true);
    await expect(header).toHaveCSS('outline-style', 'solid');
    await expect(header).toHaveCSS('outline-width', '2px');
    await expect(header).toHaveCSS('outline-color', 'rgb(245, 245, 245)');
    const focusOutline = await header.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        offset: Number.parseFloat(style.outlineOffset),
        width: Number.parseFloat(style.outlineWidth),
      };
    });
    expect(focusOutline.offset).toBeLessThanOrEqual(-focusOutline.width);
    await panel.screenshot({
      path: testInfo.outputPath('citation-disclosure-scoped-dark.png'),
    });
    await header.click();
    await collapsed();
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
