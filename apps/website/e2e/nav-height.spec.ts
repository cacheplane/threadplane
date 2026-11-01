import { test, expect } from '@playwright/test';

/**
 * `--nav-h` (styles/chrome.css) is the single source of truth for every offset
 * against the fixed nav: the docs shell's top padding, the sticky sidebar and
 * TOC rails, the mobile drawer's `top`, and html's scroll-padding.
 *
 * Its value is measured from the rendered nav, not derived from the classes, so
 * it silently drifts whenever Nav.tsx changes what it shows at a breakpoint —
 * which is exactly how the 768–1023px band came to overshoot by 15px. jsdom
 * cannot measure layout, so this is the only place the two can be compared.
 *
 * The tolerance is 1px, and deliberately not 0: the declared values round *up*
 * off the measured height (58/66/81 against 57/65/81 in Chrome at dpr 1) so the
 * offset always clears the nav rather than tucking content under it, and the
 * sub-pixel height itself moves with font rendering. 1px is the rounding; the
 * bug this guards against was fifteen.
 */
const STEPS = [
  { width: 375, note: 'phone — px-6 py-4', marketingNavH: 58, docsNavH: 58 },
  { width: 767, note: 'phone — last px before md', marketingNavH: 58, docsNavH: 58 },
  { width: 768, note: 'tablet — md padding, no lg link row', marketingNavH: 66, docsNavH: 58 },
  { width: 1023, note: 'tablet — last px before lg', marketingNavH: 66, docsNavH: 58 },
  { width: 1024, note: 'desktop — lg link row appears', marketingNavH: 81, docsNavH: 58 },
  { width: 1440, note: 'desktop', marketingNavH: 81, docsNavH: 58 },
];

/**
 * `--nav-h` is route-dependent as of the navbar redesign: marketing routes keep
 * the measured 58/66/81 ladder, and /docs is a flat 58 at every width. Both
 * have to be measured, because the declared value is rounded up off the
 * rendered height and only a browser knows what that height is.
 */
const SURFACES = [
  { name: 'marketing', url: '/', expectedNavH: (step: (typeof STEPS)[number]) => step.marketingNavH },
  {
    name: 'docs',
    url: '/docs/langgraph/getting-started/introduction',
    expectedNavH: (step: (typeof STEPS)[number]) => step.docsNavH,
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

      // The two checks above are self-consistency only: they confirm --nav-h
      // tracks whatever the nav happens to render, but they cannot see a
      // regression where the *ladder itself* collapses — e.g. the marketing
      // steps flattening to 58px like docs. If the declared value and the
      // rendered nav moved together, every self-consistency check above would
      // still pass. Pinning the declared value against the ladder we intend
      // catches that; it is a separate property from "does the variable match
      // what rendered."
      expect(
        variable,
        `--nav-h is ${variable} on ${surface.name} at ${step.width}px, but this ` +
          `ladder is meant to declare ${surface.expectedNavH(step)}px. This is a ` +
          `DESIGN change, not drift — the checks above still passed, so the ` +
          `variable and the nav moved together. Update this table only if the ` +
          `new ladder is intended.`,
      ).toBe(surface.expectedNavH(step));
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

test('the marketing nav does grow with the breakpoint', async ({ page }) => {
  // Direct counterpart to "the docs nav does not grow with the breakpoint"
  // above: docs stays flat on purpose, and marketing is supposed to keep its
  // ladder. Stating both intents as tests means a future change that
  // accidentally flattens the marketing ladder (matching it to docs) fails
  // here even though every self-consistency check elsewhere in this file
  // would still pass.
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

  expect(desktopHeight - phoneHeight).toBeGreaterThan(15);
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
