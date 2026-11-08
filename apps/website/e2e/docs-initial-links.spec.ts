import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`initial docs article links survive workspace handoff at ${width}px`, async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'CPU throttling uses Chromium CDP');
    await page.setViewportSize({ width, height: 900 });
    const session = await context.newCDPSession(page);
    try {
      // Slow hydration to overlap native link activation with the initial
      // article handoff. Unit coverage controls that race deterministically;
      // this journey clicks as soon as the real server article is actionable.
      await session.send('Emulation.setCPUThrottlingRate', { rate: 8 });
      await page.goto('/docs/react/chat/getting-started/quickstart', {
        waitUntil: 'commit',
      });
      await page
        .locator('article')
        .getByRole('link', { name: 'messages example', exact: true })
        .click();
      await expect(page).toHaveURL('/docs/react/chat/concepts/message-model');
      // Throttle the initial handoff and navigation commit only.
      await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      await expect(
        page.getByRole('heading', {
          level: 1,
          name: 'React chat messages preview',
          exact: true,
        })
      ).toBeVisible();
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        'href',
        'https://threadplane.ai/docs/react/chat/concepts/message-model'
      );
    } finally {
      // A failed navigation may already have closed the page or CDP target.
      await session
        .send('Emulation.setCPUThrottlingRate', { rate: 1 })
        .catch(() => undefined);
      await session.detach().catch(() => undefined);
    }
  });
}
