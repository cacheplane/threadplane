import { test, expect, type Page } from '@playwright/test';

/**
 * The bar is one CSS surface: a translucent white over a backdrop blur, on
 * every route at every scroll position. There is no route list, no sentinel,
 * no observer and no `data-surface` attribute any more, so there is nothing
 * here to assert about state — only that the single surface is actually the
 * one that renders.
 *
 * Two things can silently take that away, which is why this suite reads the
 * computed style out of a real browser rather than trusting the source:
 *
 * 1. The blur is prefixed by Lightning CSS, not by hand. Writing
 *    `-webkit-backdrop-filter` in chrome.css makes Lightning collapse the pair
 *    down to the prefixed property alone, and Chromium does not implement
 *    `-webkit-backdrop-filter` at all — the bar keeps its 72% alpha and loses
 *    the blur, which is an unreadable smear rather than a visible failure.
 * 2. Anything that reintroduces a scroll- or route-dependent surface brings
 *    back the hydration flash this replaced.
 */

const DOCS_ROUTE = '/docs/langgraph/getting-started/introduction';

interface BarSurface {
  readonly background: string;
  readonly backdropFilter: string;
  readonly boxShadow: string;
  readonly borderBottomColor: string;
}

async function readBarSurface(page: Page): Promise<BarSurface> {
  return page.evaluate(() => {
    const bar = document.querySelector('.nav-bar');
    if (!bar) throw new Error('no .nav-bar on the page');
    const style = getComputedStyle(bar);
    return {
      background: style.backgroundColor,
      backdropFilter: style.backdropFilter,
      boxShadow: style.boxShadow,
      borderBottomColor: style.borderBottomColor,
    };
  });
}

/** The alpha of an `rgb()`/`rgba()` computed colour; 1 when none is present. */
function alphaOf(color: string): number {
  const parts = color.match(/-?[\d.]+/g);
  if (!parts) throw new Error(`unparseable colour: ${color}`);
  return parts.length >= 4 ? Number(parts[3]) : 1;
}

// Passive surface and CTA checks share each route load. The scroll check keeps
// its full observation window so a delayed repaint still fails.
test('keeps the nav surface and route-specific CTA through scroll and docs navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [label, route] of [
    ['the marketing hero', '/'],
    ['a docs page', DOCS_ROUTE],
  ] as const) {
    await page.goto(route);
    await test.step(`the nav bar is translucent and blurred on ${label}`, async () => {
      await expect(page.locator('nav').first()).toBeVisible();

      const surface = await readBarSurface(page);

      // Strictly between 0 and 1: fully opaque is the old solid bar, fully
      // transparent is the old hero state. Neither exists any more.
      const alpha = alphaOf(surface.background);
      expect(alpha, `background was ${surface.background}`).toBeGreaterThan(0);
      expect(alpha, `background was ${surface.background}`).toBeLessThan(1);

      // `none` here is the Lightning-CSS prefix trap in the header comment: the
      // translucency survives it, so only this read catches it.
      expect(surface.backdropFilter).not.toBe('none');
      expect(surface.backdropFilter).toContain('blur');

      // The redesign removed the shadow deliberately; the hairline is the edge.
      expect(surface.boxShadow).toBe('none');
      expect(surface.borderBottomColor).not.toBe('rgba(0, 0, 0, 0)');
    });
    if (route === '/') {
      // Keep the CTA assertions polling: its colors transition on mount.
      await test.step('the marketing CTA is filled', async () => {
        const marketingCta = page
          .locator('nav')
          .first()
          .getByRole('link', { name: 'Talk to Us' });
        await expect(marketingCta).not.toHaveCSS(
          'background-color',
          'rgba(0, 0, 0, 0)'
        );
      });
      await test.step('the nav bar surface does not change when the page is scrolled', async () => {
        await expect(page.locator('nav').first()).toBeVisible();

        const atTop = await readBarSurface(page);

        await page.mouse.wheel(0, 900);
        await page.waitForFunction(() => window.scrollY > 400);
        // Long enough that a reintroduced 200ms surface transition would have
        // finished, so a difference here is a real difference and not a fade caught
        // mid-flight.
        await page.waitForTimeout(600);
        const scrolled = await readBarSurface(page);

        expect(scrolled).toEqual(atTop);
      });
    } else {
      await test.step('the docs CTA is a text link', async () => {
        const docsCta = page
          .locator('nav')
          .first()
          .getByRole('link', { name: 'Talk to Us' });
        await expect(docsCta).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(docsCta).toHaveCSS('color', 'rgb(21, 37, 62)');
      });
    }
  }
});
