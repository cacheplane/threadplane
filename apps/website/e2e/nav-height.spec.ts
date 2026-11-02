import { test, expect } from '@playwright/test';

/** Fixed-header offsets must match the actual 64px bar at every breakpoint.
 * Keep coverage on each side of md/lg: the custom panels, context drawer and
 * sticky reader all depend on this geometry. */
const STEPS = [
  { width: 375, note: 'phone' },
  { width: 767, note: 'before md' },
  { width: 768, note: 'at md' },
  { width: 1023, note: 'before lg' },
  { width: 1024, note: 'at lg' },
  { width: 1440, note: 'desktop' },
];

const SURFACES = [
  { name: 'marketing', url: '/', expectedNavH: () => 64 },
  {
    name: 'docs',
    url: '/docs/langgraph/getting-started/introduction',
    expectedNavH: () => 64,
  },
];

for (const surface of SURFACES) {
  for (const step of STEPS) {
    test(`--nav-h matches the rendered nav on ${surface.name} at ${step.width}px (${step.note})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: step.width, height: 800 });
      await page.goto(surface.url);

      const nav = page.locator('nav').first();
      await expect(nav).toBeVisible();

      const measured = await nav.evaluate((el) => el.getBoundingClientRect().height);
      const variable = await page.evaluate(() =>
        parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')),
      );

      expect(
        variable,
        `--nav-h (${variable}) drifted from the rendered nav (${measured}) on ` +
          `${surface.name} at ${step.width}px. The variable no longer describes ` +
          `reality, so every offset built on it is wrong. Re-measure the nav.`,
      ).toBeGreaterThanOrEqual(measured);
      expect(
        variable - measured,
        `--nav-h (${variable}) overshoots the rendered nav (${measured}) by ` +
          `${(variable - measured).toFixed(2)}px on ${surface.name} at ` +
          `${step.width}px. Overshoot becomes dead space above the content.`,
      ).toBeLessThanOrEqual(1);

      expect(
        variable,
        `--nav-h is ${variable} on ${surface.name} at ${step.width}px, but this ` +
          `ladder is meant to declare ${surface.expectedNavH()}px. This is a ` +
          `DESIGN change, not drift — the checks above still passed, so the ` +
          `variable and the nav moved together. Update this table only if the ` +
          `new ladder is intended.`,
      ).toBe(surface.expectedNavH());
    });
  }
}

test('the docs nav does not grow with the breakpoint', async ({ page }) => {
  const heights: number[] = [];
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/docs/langgraph/getting-started/introduction');
    heights.push(
      await page
        .locator('nav')
        .first()
        .evaluate((el) => el.getBoundingClientRect().height),
    );
  }
  const [phone] = heights;
  for (const height of heights) expect(Math.abs(height - phone)).toBeLessThanOrEqual(1);
});

test('the marketing nav keeps the same height at every breakpoint', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  const phoneHeight = await page
    .locator('nav')
    .first()
    .evaluate((el) => el.getBoundingClientRect().height);

  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto('/');
  const desktopHeight = await page
    .locator('nav')
    .first()
    .evaluate((el) => el.getBoundingClientRect().height);

  expect(Math.abs(desktopHeight - phoneHeight)).toBeLessThanOrEqual(1);
});

test('keeps the tablet docs column and context drawer flush under the nav', async ({
  page,
}) => {
  await test.step('the docs column starts directly under the nav at a tablet width', async () => {
    // The 15px overshoot showed up here as dead space above the breadcrumb.
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto('/docs/langgraph/getting-started/introduction');
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
      'data-hydrated',
      'true'
    );

    const navBottom = await page
      .locator('nav')
      .first()
      .evaluate((el) => el.getBoundingClientRect().bottom);
    const shellTop = await page
      .locator('.website-workspace-host .workspace-shell')
      .evaluate((el) => el.getBoundingClientRect().top);

    expect(Math.abs(shellTop - navBottom)).toBeLessThanOrEqual(1);
  });
  await test.step('the workspace context drawer hangs flush off the nav at tablet width', async () => {
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
      'data-hydrated',
      'true'
    );

    await page.getByRole('button', { name: 'Open context' }).click();
    const overlay = page.getByRole('dialog', {
      name: 'Documentation control plane context',
    });
    await expect(overlay).toBeVisible();

    const navBottom = await page
      .locator('nav')
      .first()
      .evaluate((el) => el.getBoundingClientRect().bottom);
    const overlayTop = await overlay.evaluate(
      (el) => el.getBoundingClientRect().top
    );

    expect(Math.abs(overlayTop - navBottom)).toBeLessThanOrEqual(1);
  });
});
