import { test, expect, type APIRequestContext } from '@playwright/test';

/*
 * What the homepage downloads on a phone, before and while the hero poster —
 * the LCP element — is loading.
 *
 * On a throttled mobile load every request starts at once and shares one
 * connection, so anything the page does not need competes with the poster for
 * bandwidth. Measured on production (Lighthouse mobile, devtools throttling),
 * LCP was ~4.0s with FCP equal to it; blocking all JavaScript alone brought it
 * to ~2.8s, because the poster is server-rendered and needs none of it.
 *
 * Two things were shipping to `/` that it never uses:
 *
 *  - the docs workspace's capability catalog (@threadplane/cockpit-registry),
 *    because app/layout.tsx imported the root shell from the same module as
 *    the docs surface that reaches it. The surface now lives in its own module
 *    and is handed to the root shell by docs routes at registration.
 *  - a preload of Inter, which only diagrams use and none sit above the fold.
 */

/**
 * A capability title that exists only in the registry's catalog. Minification
 * keeps string literals, so it survives into whichever bundle carries the
 * catalog. The docs-route test below proves this marker still appears where
 * the catalog belongs, so a rename cannot make its absence on `/` vacuous.
 */
const REGISTRY_MARKER = 'LangGraph Durable Execution (Python)';

/** A docs route, which renders the workspace surface and so needs the catalog. */
const DOCS_ROUTE = '/docs/langgraph/guides/streaming';

/**
 * The fonts the homepage's above-the-fold hero actually renders: Archivo Black
 * (the H1), Archivo normal and italic (one next/font instance, so they preload
 * together), and JetBrains Mono (the eyebrow and the demo's URL bar). A fifth
 * preload is a new High-priority request racing the LCP image on a phone — add
 * one only after measuring that it is above the fold.
 */
const MAX_FONT_PRELOADS = 4;

/**
 * The bodies of the scripts `path` itself requires: the `<script src>` tags and
 * script preloads in its server-rendered HTML — the route's entry chunks plus
 * every client component it renders and hydrates.
 *
 * Deliberately NOT every script the page ever fetches. In production, Next.js
 * idly prefetches the routes behind in-viewport links after the page loads, so
 * scrolling the homepage past a `/docs/...` link fetches that route's chunks —
 * the capability catalog included. That is correct, happens after LCP, and is
 * what makes the docs navigation fast; counting it would fail this guard for
 * the wrong reason. What matters is what `/` makes the browser download to
 * render itself.
 */
async function routeScripts(request: APIRequestContext, path: string): Promise<string[]> {
  const html = await (await request.get(path)).text();
  const srcs = new Set<string>();
  for (const match of html.matchAll(/<script[^>]+src="([^"]+\.js[^"]*)"/g)) srcs.add(match[1]);
  for (const match of html.matchAll(/<link[^>]+rel="preload"[^>]+as="script"[^>]+href="([^"]+)"/g)) srcs.add(match[1]);
  for (const match of html.matchAll(/<link[^>]+href="([^"]+)"[^>]+as="script"/g)) srcs.add(match[1]);
  // Our own bundle only; the page also embeds cross-origin third parties.
  const own = [...srcs].filter((src) => src.startsWith('/'));
  return Promise.all(own.map(async (src) => (await request.get(src)).text()));
}

test.describe('homepage bundle', () => {
  test('the homepage does not ship the docs capability catalog', async ({ request }) => {
    const scripts = await routeScripts(request, '/');
    expect(scripts.length).toBeGreaterThan(0);
    const carriers = scripts.filter((body) => body.includes(REGISTRY_MARKER));
    expect(carriers, 'a script loaded by / carries the cockpit capability catalog').toHaveLength(0);
  });

  test('a docs route still ships the catalog it renders', async ({ request }) => {
    const scripts = await routeScripts(request, DOCS_ROUTE);
    expect(
      scripts.some((body) => body.includes(REGISTRY_MARKER)),
      `the marker "${REGISTRY_MARKER}" no longer appears on ${DOCS_ROUTE}; pick a current capability title so the homepage check above is not vacuous`
    ).toBe(true);
  });

  test('the homepage preloads only the fonts the hero renders', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const preloads = await page.locator('link[rel="preload"][as="font"]').count();
    expect(preloads).toBeGreaterThan(0);
    expect(preloads).toBeLessThanOrEqual(MAX_FONT_PRELOADS);
  });
});
