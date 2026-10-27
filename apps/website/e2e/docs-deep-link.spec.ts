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
 * Two page kinds scroll through different machinery and both are guarded here:
 *
 *   - A non-workspace docs page (`/docs/choosing-an-adapter`) scrolls the
 *     document. `html`'s `scroll-padding-top` (global.css) clears the fixed
 *     nav, so the heading lands just below it.
 *   - A workspace docs page (`/docs/[library]/[section]/[slug]`) does not.
 *     `html:has([data-website-workspace-host])` is `overflow: hidden`
 *     (styles/docs.css) and the only scroller is `.docs-workspace-article`
 *     inside the shell — which the shell mounts during hydration, throwing
 *     away whatever fragment scroll the browser had already performed on the
 *     document. `WebsiteWorkspaceSurface` re-applies it; without that the
 *     heading is stranded thousands of pixels below the reading pane.
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
  route: string,
  scrollRootSelector: string | null
): Promise<DeepLinkTarget> {
  await page.goto(route);
  if (scrollRootSelector) {
    // Before the shell hydrates, `.docs-workspace-article` is server-rendered
    // straight into the page and is not yet a scroller — measuring it then
    // yields a scroll range that has nothing to do with the one under test.
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
      'data-hydrated',
      'true'
    );
  }
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

  const target = await page.evaluate((selector) => {
    const root = selector
      ? document.querySelector<HTMLElement>(selector)
      : document.documentElement;
    if (!root) return null;
    const rootTop = selector ? root.getBoundingClientRect().top : 0;
    const rootScroll = selector ? root.scrollTop : window.scrollY;
    const viewport = selector ? root.clientHeight : window.innerHeight;
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
  }, scrollRootSelector);

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
  test('a hard load with a heading fragment reaches the heading (non-workspace page)', async ({
    page,
  }) => {
    const route = '/docs/choosing-an-adapter';
    await page.setViewportSize({ width: 1280, height: 900 });
    const target = await findDeepLinkTarget(page, route, null);

    await hardLoad(page, `${route}#${target.id}`);

    // The heading's distance below the bottom edge of the fixed nav.
    // `scroll-padding-top: calc(var(--nav-h) + 16px)` (global.css) puts it at
    // that 16px gutter; the band absorbs sub-pixel nav geometry without
    // admitting a page that simply never scrolled.
    const gapBelowNav = () =>
      page.evaluate((id) => {
        const heading = document.getElementById(id);
        const nav = document.querySelector('[data-site-navigation]');
        // A heading still in React's hidden streaming holder has no boxes and
        // reads as top 0, which would pass the poll before anything scrolled.
        if (!heading || !nav || heading.getClientRects().length === 0) {
          return null;
        }
        return Math.round(
          heading.getBoundingClientRect().top -
            nav.getBoundingClientRect().bottom
        );
      }, target.id);

    // `scroll-behavior: smooth` animates the jump, so poll rather than sample.
    // The window is generous because a loaded `next dev` server can be slow to
    // stream the document; it only ever buys time for the *correct* resting
    // place, so a page that lands somewhere else still fails.
    await expect
      .poll(gapBelowNav, {
        message: 'heading never came to rest below the fixed nav',
        timeout: 15_000,
      })
      .toBeLessThanOrEqual(32);

    // ...and it stopped below the nav rather than behind it.
    expect(await gapBelowNav()).toBeGreaterThanOrEqual(0);
  });

  test('a hard load with a heading fragment reaches the heading (workspace page)', async ({
    page,
  }) => {
    const route = '/docs/langgraph/guides/streaming';
    await page.setViewportSize({ width: 1280, height: 900 });
    const target = await findDeepLinkTarget(
      page,
      route,
      '.docs-workspace-article'
    );

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
            if (!heading || !article) return null;
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
          message: 'heading never came to rest at the top of the reading pane',
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
});
