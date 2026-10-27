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
 * The fonts the homepage preloads, identified by family and style. See the
 * FONT PRELOADS note in app/layout.tsx for the measurements behind this list:
 * on a throttled phone every preloaded font races the hero poster for
 * bandwidth, so only faces whose late arrival would visibly hurt are here.
 * Archivo italic and JetBrains Mono were measured at -228ms and -224ms of LCP
 * each; Archivo normal stays because un-preloading it reflowed the subhead
 * (CLS 0.206). Change this list only with a measurement.
 */
const EXPECTED_PRELOADS = ['Archivo Black normal', 'Archivo normal'];

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

  test('the homepage preloads only the H1 face and the body face', async ({ page }) => {
    // Read the live DOM, not the server HTML: under `next dev` React injects
    // the font preloads into <head> during hydration, while a production build
    // writes them into the HTML. The DOM has them either way.
    await page.goto('/', { waitUntil: 'load' });
    const faces = await page.evaluate(() => {
      const files = [...document.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="font"]')].map(
        (link) => new URL(link.href).pathname.split('/').pop() ?? ''
      );
      // Resolve each preloaded file to its @font-face through the CSSOM: a bare
      // count would pass with the wrong face preloaded, e.g. the italic.
      const rules: CSSFontFaceRule[] = [];
      for (const sheet of [...document.styleSheets]) {
        let list: CSSRuleList;
        try {
          list = sheet.cssRules;
        } catch {
          continue; // a cross-origin sheet; ours are same-origin
        }
        for (const rule of [...list]) if (rule instanceof CSSFontFaceRule) rules.push(rule);
      }
      return files.map((file) => {
        const rule = rules.find((r) => r.style.getPropertyValue('src').includes(file));
        const family = rule?.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
        const style = rule?.style.getPropertyValue('font-style').trim() || 'normal';
        return `${family} ${style}`;
      });
    });
    expect(faces.sort()).toEqual([...EXPECTED_PRELOADS].sort());
  });

  test('the unpreloaded italic still merges into the Archivo family', async ({ page }) => {
    // Archivo's italic is its own next/font instance so it can skip the
    // preload. That only works because both instances register the real
    // family name, `Archivo`, and the browser merges them: italic text then
    // picks the true italic. If the italic ended up under any other family,
    // this load would find no italic face and every italic would turn faux.
    await page.goto('/');
    const faces = await page.evaluate(async () =>
      (await document.fonts.load('italic 400 16px Archivo')).map((f) => `${f.family.replace(/["']/g, '')} ${f.style}`)
    );
    expect(faces).toContain('Archivo italic');
  });

  test('monospace text never falls back to a proportional font', async ({ page }) => {
    // JetBrains Mono is not preloaded, so its fallback is visible while it
    // loads. next/font's generated fallback for it is `local(Arial)`, which
    // would misalign code; layout.tsx replaces it with a monospace stack.
    await page.goto('/');
    const stack = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--font-mono')
    );
    expect(stack).toContain('ui-monospace');
    expect(stack).toContain('monospace');
    expect(stack).not.toContain('JetBrains Mono Fallback');
  });
});
