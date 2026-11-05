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
              content: 'إجابة [^safe] و [^blocked].',
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
    const scopedTheme = await trigger.evaluate((button) => {
      const scope = button.closest('article');
      if (!scope) throw new Error('Expected message scope');
      const original = {
        className: scope.className,
        style: scope.getAttribute('style'),
      };
      const reset = document.createElement('style');
      reset.id = 'inline-preview-theme-proof';
      const properties = Array.from(
        getComputedStyle(document.documentElement)
      ).filter((name) => name.startsWith('--ds-'));
      reset.textContent = `:root { ${properties
        .map((name) => `${name}: initial !important;`)
        .join(' ')} }`;
      document.head.append(reset);
      scope.classList.add('tp-chat');
      scope.style.colorScheme = 'dark';
      scope.style.setProperty(
        '--tp-chat-text',
        'light-dark(rgb(28, 28, 28), rgb(245, 245, 245))'
      );
      scope.style.setProperty(
        '--tp-chat-surface',
        'light-dark(rgb(255, 255, 255), rgb(28, 28, 28))'
      );
      return original;
    });
    await trigger.click();
    await expect(dialog).toHaveCSS('color', 'rgb(245, 245, 245)');
    await expect(dialog).toHaveCSS('background-color', 'rgb(28, 28, 28)');
    await expect(dialog).toHaveCSS('color-scheme', 'dark');
    expect(
      await trigger.evaluate((node) =>
        getComputedStyle(node).getPropertyValue('--ds-surface').trim()
      )
    ).toBe('');
    for (const control of [close, link]) {
      await expect(control).toHaveCSS('color-scheme', 'dark');
      const contrast = await control.evaluate((node) => {
        const computed = getComputedStyle(node);
        const rgb = computed.color
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number);
        if (!rgb) return 0;
        const luminance = (values: number[]) =>
          values
            .map((value) => {
              const c = value / 255;
              return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            })
            .reduce(
              (sum, value, index) =>
                sum + value * [0.2126, 0.7152, 0.0722][index],
              0
            );
        const background = computed.backgroundColor
          .match(/[\d.]+/g)
          ?.map(Number);
        const effective =
          background && (background.length < 4 || background[3] !== 0)
            ? background.slice(0, 3)
            : [28, 28, 28];
        const foregroundLuminance = luminance(rgb);
        const backgroundLuminance = luminance(effective);
        return (
          (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
          (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
        );
      });
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    }
    await page.screenshot({
      path: testInfo.outputPath('inline-preview-scoped-dark.png'),
    });
    await close.click();
    await trigger.evaluate((button, original) => {
      const scope = button.closest('article');
      if (!scope) throw new Error('Expected message scope');
      scope.className = original.className;
      if (original.style === null) scope.removeAttribute('style');
      else scope.setAttribute('style', original.style);
      document.getElementById('inline-preview-theme-proof')?.remove();
    }, scopedTheme);
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
