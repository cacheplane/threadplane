import { test, expect, type Page } from '@playwright/test';

/**
 * Hard-loading a docs URL that carries a heading fragment.
 *
 * This is the shape every shared link, every search-engine result, and every
 * hit from the docs search index takes: the browser is handed
 * `/docs/…#some-heading` cold, with no in-page click to fall back on. The
 * failure mode is silent — the page renders perfectly, just at the top — so
 * nothing but a positional assertion catches it.
 *
 * Both neutral and framework docs use the same workspace scroller. Hydration
 * transfers the server-rendered article from the document into that pane;
 * WebsiteWorkspaceSurface must restore the original fragment after the transfer.
 *
 * Note for anyone debugging a red run by hand: on a *cold* `next dev` server
 * the first request for a route compiles it, `load` fires before the document
 * is laid out, and Chrome drops the pending fragment scroll — so the very
 * first hard load of a docs URL can look broken in dev even when the product
 * is fine. It does not happen against a production build. Each test below
 * visits its route once before the hard load, which pays that compile.
 */

interface DeepLinkTarget {
  readonly id: string;
  /** Distance from the top of the scroller's content, at scrollTop 0. */
  readonly offset: number;
}

/**
 * The deepest heading in the article's own rail that can actually come to rest
 * at the top of its scroller.
 *
 * Deliberately read off the page rather than hardcoded: a heading id baked
 * into this file goes stale the first time someone retitles a section, and the
 * test then passes vacuously against a fragment that matches nothing. The
 * reachability filter matters just as much — the last heading on a page is
 * usually inside the final screenful, where scrolling to it hits the end of
 * the scroll range and the assertion would fail on a page that works.
 */
async function findDeepLinkTarget(
  page: Page,
  route: string
): Promise<DeepLinkTarget> {
  await page.goto(route);
  // Before hydration, the server-rendered article is not yet a scroll pane.
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-hydrated',
    'true'
  );
  await expect(page.locator('.docs-toc-link').first()).toBeVisible();
  // The rail is not the article. Under `next dev` the article streams in
  // after the shell (see `MdxRenderer`), first into a hidden holding element,
  // so measure only once every rail link resolves to a laid-out heading.
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll('.docs-toc-link')].every((link) => {
          const href = link.getAttribute('href');
          if (!href?.startsWith('#')) return true;
          const heading = document.getElementById(href.slice(1));
          return Boolean(heading && heading.getClientRects().length > 0);
        })
      )
    )
    .toBe(true);

  const target = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('.docs-workspace-article');
    if (!root) return null;
    const rootTop = root.getBoundingClientRect().top;
    const rootScroll = root.scrollTop;
    const viewport = root.clientHeight;
    const maxScroll = root.scrollHeight - viewport;

    let deepest: { id: string; offset: number } | null = null;
    for (const link of document.querySelectorAll('.docs-toc-link')) {
      const href = link.getAttribute('href');
      if (!href?.startsWith('#')) continue;
      const heading = document.getElementById(href.slice(1));
      if (!heading) continue;
      const offset = Math.round(
        heading.getBoundingClientRect().top - rootTop + rootScroll
      );
      // Below the fold, so "it scrolled" is not vacuously true, and inside the
      // scroll range, so the scroller can put it at its top edge.
      if (offset > viewport && offset <= maxScroll) {
        deepest = { id: href.slice(1), offset };
      }
    }
    return deepest;
  });

  expect(target, `no reachable off-screen rail heading on ${route}`).not.toBe(
    null
  );
  return target as DeepLinkTarget;
}

/**
 * A real document load, not a same-document hash change.
 *
 * `page.goto()` to a URL that differs from the current one only by its
 * fragment scrolls in place and never reloads — which is the case that already
 * works, and would have made both tests here pass against the broken build.
 */
async function hardLoad(page: Page, url: string): Promise<void> {
  await page.goto('about:blank');
  await page.goto(url);
}

test.describe('docs deep links', () => {
  for (const route of [
    '/docs/choosing-an-adapter',
    '/docs/angular/langgraph/guides/streaming',
  ]) {
    test(`a hard load with a heading fragment reaches the workspace heading (${route})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      const target = await findDeepLinkTarget(page, route);

      await hardLoad(page, `${route}#${target.id}`);
      await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
        'data-hydrated',
        'true'
      );

      // The reading pane is the scroller here, so the heading comes to rest at
      // its top edge — exactly where clicking the same rail link puts it.
      await expect
        .poll(
          () =>
            page.evaluate((id) => {
              const heading = document.getElementById(id);
              const article = document.querySelector('.docs-workspace-article');
              if (!heading || !article || heading.getClientRects().length === 0)
                return Number.POSITIVE_INFINITY;
              // Absolute distance: overshooting the heading (landing it above
              // the pane, off screen) is as broken as never reaching it.
              return Math.abs(
                Math.round(
                  heading.getBoundingClientRect().top -
                    article.getBoundingClientRect().top
                )
              );
            }, target.id),
          {
            message:
              'heading never came to rest at the top of the reading pane',
            timeout: 15_000,
          }
        )
        .toBeLessThanOrEqual(8);

      // ...and the pane genuinely scrolled to get there.
      const articleScrollTop = await page
        .locator('.docs-workspace-article')
        .evaluate((element) => element.scrollTop);
      expect(articleScrollTop).toBeGreaterThan(0);
    });
  }

  test('soft navigation to adapter guidance retains the shell and scrolls headings inside it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const route = '/docs/choosing-an-adapter';
    const target = await findDeepLinkTarget(page, route);
    await page.goto('/docs');
    const shell = page.locator('[data-workspace-shell]');
    await expect(shell).toHaveAttribute('data-hydrated', 'true');
    await shell.evaluate((element) =>
      element.setAttribute('data-lifetime-check', 'original')
    );
    await page
      .getByRole('link', { name: 'Choosing an adapter', exact: true })
      .click();
    await expect(page).toHaveURL(route);
    await expect(shell).toHaveAttribute('data-lifetime-check', 'original');
    await expect(
      page.locator('.docs-workspace-article .docs-toc')
    ).toBeVisible();
    await expect(page.locator(`article [id="${target.id}"]`)).toBeVisible();
    await page.locator(`.docs-toc-link[href="#${target.id}"]`).click();
    await expect
      .poll(() =>
        page.evaluate((id) => {
          const heading = document.getElementById(id);
          const root = document.querySelector('.docs-workspace-article');
          if (!heading || !root || !heading.getClientRects().length)
            return Number.POSITIVE_INFINITY;
          return Math.abs(
            heading.getBoundingClientRect().top -
              root.getBoundingClientRect().top
          );
        }, target.id)
      )
      .toBeLessThanOrEqual(8);
    await expect(
      page.locator(`.docs-toc-link[href="#${target.id}"]`)
    ).toHaveAttribute('data-active', 'true');
    expect(
      await page
        .locator('.docs-workspace-article')
        .evaluate((element) => element.scrollTop)
    ).toBeGreaterThan(0);
  });
});
