import { test, expect } from '@playwright/test';

for (const width of [1440, 1024, 768, 375]) {
  test(`lower homepage maintains its grid and usable form at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    const input = page.locator('#teams').getByLabel('Work email');
    const box = (await input.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeLessThanOrEqual(56);
    const layout = await page
      .locator('.home-page > section > [data-ui="container"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const box = node.getBoundingClientRect();
          return { x: box.x, right: box.right };
        })
      );
    for (const box of layout) {
      expect(box.x).toBeCloseTo(layout[0].x, 0);
      expect(box.right).toBeCloseTo(layout[0].right, 0);
    }
    const articles = page.locator('#articles .post-card');
    await expect(articles).toHaveCount(3);
    if (width >= 768) {
      const sizes = await articles.evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect().height)
      );
      for (const height of sizes) expect(height).toBeCloseTo(sizes[0], 0);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth
      )
    ).toBeLessThanOrEqual(1);
  });
}

test('field report validates and handles a successful signup without leaving home', async ({
  page,
}) => {
  let payload: Record<string, unknown> | undefined;
  await page.route('**/api/whitepaper-signup', async (route) => {
    payload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.goto('/');
  const section = page.locator('#teams');
  await section.getByRole('button', { name: 'Get the field report' }).click();
  await expect(section.getByLabel('Work email')).toHaveAttribute(
    'aria-invalid',
    'true'
  );
  expect(payload).toBeUndefined();
  await section.getByLabel('Work email').fill('reader@example.com');
  await section.getByRole('button', { name: 'Get the field report' }).click();
  await expect(section.getByText('Check your inbox.')).toBeVisible();
  expect(payload).toMatchObject({
    email: 'reader@example.com',
    paper: 'overview',
    policy_version: 'growth_v1.2026-09-09',
  });
  await expect(
    section.getByRole('link', { name: 'Download the PDF directly' })
  ).toHaveAttribute('href', '/whitepaper.pdf');
});

test('FAQ opens with the keyboard and homepage article styles stay on home', async ({
  page,
}) => {
  await page.goto('/');
  const summary = page.locator('#questions summary').first();
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#questions details').first()).toHaveAttribute(
    'open',
    ''
  );
  await expect(
    page
      .locator('#questions')
      .getByRole('link', { name: 'Choosing an adapter' })
  ).toBeVisible();
  await expect(page.locator('#articles .post-card-tags').first()).toBeHidden();
  await page
    .locator('#articles')
    .getByRole('link', { name: 'View all articles' })
    .click();
  await expect(page).toHaveURL(/\/blog$/);
  await expect(page.locator('.home-page')).toHaveCount(0);
  // Both surfaces intentionally use borderless cards. Home alone hides tags;
  // the blog keeps them visible for readers browsing article topics.
  await expect(page.locator('.post-card-tags').first()).toBeVisible();
});
