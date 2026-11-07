import { expect, test } from '@playwright/test';

test('stale newsletter policy keeps a usable refresh action on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.route('**/api/newsletter', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'policy_version_mismatch' }),
    })
  );
  await page.goto('/privacy');
  await page.getByLabel('Email', { exact: true }).fill('reader@example.com');
  await page.getByRole('button', { name: 'Subscribe', exact: true }).click();
  const refresh = page.getByRole('button', {
    name: 'Refresh page',
    exact: true,
  });
  await expect(refresh).toBeVisible();
  expect((await refresh.boundingBox())?.height).toBeGreaterThanOrEqual(44);
});

test('mobile navigation keeps focus inside its drawer', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/privacy');
  await page.getByRole('button', { name: 'Open menu' }).click();
  const drawer = page.getByRole('dialog', { name: 'Mobile navigation' });
  await expect(drawer).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press(i < 6 ? 'Tab' : 'Shift+Tab');
    expect(
      await drawer.evaluate((el) => el.contains(document.activeElement))
    ).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused();
});

for (const route of ['/privacy', '/docs/angular/langgraph/guides/streaming']) {
  test(`keyboard users can skip navigation on ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => !!document.activeElement?.closest('main'))
    ).toBe(true);
  });
}

for (const width of [320, 375, 768, 1440, 1920]) {
  test(`footer stays aligned and touchable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/privacy');
    const footer = page.locator('footer');
    await expect(footer.getByRole('navigation')).toHaveCount(4);
    const geometry = await footer.evaluate((el) => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      targets: [...el.querySelectorAll('a, input[type="email"], button')].map(
        (target) => ({
          name: target.textContent || target.getAttribute('aria-label'),
          height: target.getBoundingClientRect().height,
        })
      ),
    }));
    expect(geometry.overflow).toBe(false);
    for (const target of geometry.targets)
      expect(target.height, target.name || 'input').toBeGreaterThanOrEqual(44);
    await expect(
      footer.getByRole('link', { name: 'React guide', exact: true })
    ).toHaveAttribute('href', '/docs/react/getting-started/quickstart');
    await expect(
      footer.getByRole('link', { name: 'Angular guide', exact: true })
    ).toHaveAttribute('href', '/docs/angular/getting-started/introduction');
  });
}
