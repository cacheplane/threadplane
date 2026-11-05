import { test } from './fixtures';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';

test('installed inline previews bridge keyboard focus, transfer hover and retire across selection without owner effects', async ({
  page,
  retainedConsumer,
}, testInfo) => {
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { startCheckedServer } = await import('../tooling/retained-build.mjs');
  const a = threadEnvelope('a', 'Conversation A'),
    b = threadEnvelope('b', 'Conversation B');
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
              content: 'Answer [^safe] and [^blocked].',
              additional_kwargs: {
                citations: [
                  {
                    id: 'safe',
                    index: 1,
                    title: '<b>Literal inline source</b>',
                    url: 'https://example.test/source',
                    snippet: '<img src=x> ' + 'Long'.repeat(100),
                    iconUrl: 'https://never.invalid/icon',
                  },
                  {
                    id: 'blocked',
                    index: 2,
                    title: 'Blocked',
                    url: 'javascript:evil',
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
      errors.push(route.request().url());
      return route.abort();
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(origin + '/?thread=a');
    const draft = page.getByLabel('Message', { exact: true });
    await expect(draft).toBeEnabled();
    await draft.fill('Retained inline draft');
    const textarea = await draft.elementHandle();
    assert.ok(textarea);
    const trigger = page.getByRole('button', {
      name: 'Citation 1: <b>Literal inline source</b>',
      exact: true,
    });
    const dialog = page.getByRole('dialog', { name: 'Source 1', exact: true });
    const close = dialog.getByRole('button', { name: 'Close', exact: true });
    const link = dialog.getByRole('link', { name: 'Open source', exact: true });
    const preserved = async (count = 3) => {
      expect(backend.requests).toHaveLength(count);
      await expect(draft).toHaveValue('Retained inline draft');
      expect(
        await textarea.evaluate(
          (node) => node === document.querySelector('#message')
        )
      ).toBe(true);
    };
    await trigger.focus();
    await expect(dialog).toBeVisible();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(link).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Citation 2: Blocked', exact: true })
    ).toBeFocused();
    await trigger.click();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(dialog).toHaveCount(0);
    await page.keyboard.press('Control+Enter');
    await expect(dialog).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('<img src=x>');
    await expect(dialog.locator('img,b,script')).toHaveCount(0);
    await expect(link).toHaveAttribute('href', 'https://example.test/source');
    await page.keyboard.press('Tab');
    await close.click();
    await expect(trigger).toBeFocused();
    await expect(dialog).toHaveCount(0);
    await preserved();
    await draft.focus();
    await trigger.hover();
    await expect(dialog).toBeVisible();
    await dialog.hover();
    await page.waitForTimeout(230);
    await expect(dialog).toBeVisible();
    await page.mouse.move(1, 1);
    await expect(dialog).toHaveCount(0);
    await trigger.hover();
    await expect(dialog).toBeVisible();
    await trigger.focus();
    await page.mouse.move(1, 1);
    await page.waitForTimeout(230);
    await expect(dialog).toBeVisible();
    await draft.click();
    await expect(dialog).toHaveCount(0);
    await expect(draft).toBeFocused();
    await preserved();
    await page
      .locator('html')
      .evaluate((node) => node.setAttribute('dir', 'rtl'));
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 600 });
      await trigger.click();
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveCSS('direction', 'rtl');
      await expect
        .poll(async () => {
          const box = await dialog.boundingBox();
          return (
            !!box &&
            box.x >= 7 &&
            box.x + box.width <= width - 7 &&
            box.y >= 7 &&
            box.y + box.height <= 593
          );
        })
        .toBe(true);
      expect(
        await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)
      ).toBe(true);
      const closeBox = await close.boundingBox();
      assert.ok(closeBox);
      expect(closeBox.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({
        path: testInfo.outputPath(`inline-preview-rtl-${width}.png`),
      });
      await page.keyboard.press('Escape');
      await preserved();
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page
      .locator('html')
      .evaluate((node) => node.setAttribute('dir', 'ltr'));
    await trigger.click();
    const originalStyle = await trigger.getAttribute('style');
    await trigger.evaluate((node) =>
      Object.assign(node.style, {
        position: 'fixed',
        bottom: '10px',
        left: '40px',
      })
    );
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await expect
      .poll(async () => {
        const anchor = await trigger.boundingBox();
        const card = await dialog.boundingBox();
        return !!anchor && !!card && card.y + card.height <= anchor.y - 5;
      })
      .toBe(true);
    await trigger.evaluate((node) => {
      node.style.bottom = '40px';
    });
    await dialog.evaluate((node) =>
      node.dispatchEvent(new Event('scroll', { bubbles: true }))
    );
    await expect
      .poll(async () => {
        const anchor = await trigger.boundingBox();
        const card = await dialog.boundingBox();
        return (
          !!anchor &&
          !!card &&
          Math.abs(card.y + card.height - (anchor.y - 6)) < 2
        );
      })
      .toBe(true);
    await trigger.evaluate((node, original) => {
      if (original === null) node.removeAttribute('style');
      else node.setAttribute('style', original);
    }, originalStyle);
    await expect(dialog).toBeVisible();
    await draft.focus();
    await page.mouse.move(1, 1);
    await trigger.hover();
    const old = await trigger.elementHandle();
    assert.ok(old);
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
    await expect(dialog).toHaveCount(0);
    await select('a');
    await backend.steps[6].received;
    await expect(trigger).toBeVisible();
    await page.waitForTimeout(250);
    await expect(dialog).toHaveCount(0);
    expect(await old.evaluate((node) => node.isConnected)).toBe(false);
    await old.evaluate((node) => (node as HTMLButtonElement).click());
    await expect(dialog).toHaveCount(0);
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

test('installed inline preview remains available to touch activation without hover', async ({
  browser,
  retainedConsumer,
}) => {
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { startCheckedServer } = await import('../tooling/retained-build.mjs');
  const a = threadEnvelope('a', 'Conversation A');
  const backend = await startProofServer([
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [a],
    },
    { method: 'GET', path: '/api/threads/a', body: a },
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
                content: 'Answer [^touch]',
                additional_kwargs: {
                  citations: [
                    {
                      id: 'touch',
                      index: 1,
                      title: 'Touch source',
                      url: '/source',
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
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  let server: Awaited<ReturnType<typeof startCheckedServer>> | undefined;
  try {
    server = await startCheckedServer({
      retained: retainedConsumer,
      target: backend.origin + '/api',
    });
    const page = await context.newPage();
    await page.goto(server.url + '/?thread=a');
    const trigger = page.getByRole('button', {
      name: 'Citation 1: Touch source',
      exact: true,
    });
    await expect(trigger).toBeVisible();
    expect(
      await page.evaluate(
        () => matchMedia('(hover: hover) and (pointer: fine)').matches
      )
    ).toBe(false);
    const draft = page.getByLabel('Message', { exact: true });
    await draft.fill('Touch draft');
    await trigger.tap();
    const panel = page.getByRole('dialog', { name: 'Source 1', exact: true });
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(panel).toHaveCount(0);
    await expect(draft).toHaveValue('Touch draft');
    expect(backend.requests).toHaveLength(3);
    backend.verify();
  } finally {
    await context.close();
    await server?.close();
    await backend.close();
  }
});
