// SPDX-License-Identifier: MIT
import { expect, test, type APIRequestContext } from '@playwright/test';

import {
  NON_INDEXED_PUBLIC_ROUTES,
  RETIRED_ROUTE_PATTERN,
  allBarredPatterns,
  findBarredCopy,
} from '../src/lib/public-copy-contract';

/**
 * The public copy boundary, checked against served output rather than source.
 *
 * The unit scan reads the repository; this reads what a visitor actually
 * receives. They can disagree — a template, a generated bundle, or a response
 * body can reintroduce a claim that no `.mdx` file contains — and the served
 * side is the one that matters.
 */

async function sitemapRoutes(request: APIRequestContext): Promise<string[]> {
  const response = await request.get('/sitemap.xml');
  expect(response.ok(), '/sitemap.xml must be served').toBe(true);
  const xml = await response.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/gu)].map(
    (match) => new URL(match[1]).pathname
  );
}

test.describe('public copy boundary', () => {
  test('every indexed page is free of barred claims and retired links', async ({
    request,
  }) => {
    const routes = await sitemapRoutes(request);
    expect(routes.length, 'the sitemap must not be empty').toBeGreaterThan(50);

    // Every route is fetched and checked, a few at a time: the sitemap lists
    // over a thousand generated API pages, and one request at a time takes
    // the crawl to the test's time bound. Findings keep sitemap order.
    const findings: string[][] = routes.map(() => []);
    let next = 0;
    const crawl = async () => {
      for (let index = next++; index < routes.length; index = next++) {
        const route = routes[index];
        const response = await request.get(route);
        expect(response.ok(), `${route} must be served`).toBe(true);
        const body = await response.text();

        for (const hit of findBarredCopy(body))
          findings[index].push(`${route} — ${hit}`);
        if (RETIRED_ROUTE_PATTERN.test(body)) {
          findings[index].push(
            `${route} — links a retired documentation route`
          );
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, crawl));

    expect(findings.flat()).toEqual([]);
  });

  test('non-indexed public routes are checked too', async ({ request }) => {
    const offenders: string[] = [];
    for (const route of NON_INDEXED_PUBLIC_ROUTES) {
      const response = await request.get(route);
      expect(response.ok(), `${route} must be served`).toBe(true);
      const body = await response.text();

      for (const hit of findBarredCopy(body)) offenders.push(`${route} — ${hit}`);
      if (RETIRED_ROUTE_PATTERN.test(body)) {
        offenders.push(`${route} — links a retired documentation route`);
      }
    }

    expect(offenders).toEqual([]);
  });

  test('public API error bodies carry no product-specific wording', async ({
    request,
  }) => {
    const malformed = await request.post('/api/ingest', {
      headers: { 'content-type': 'application/json' },
      data: '{',
    });
    const empty = await request.post('/api/ingest', {
      headers: { 'content-type': 'application/json' },
      data: {},
    });

    for (const response of [malformed, empty]) {
      const body = await response.text();
      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(body).not.toMatch(/telemetry/iu);
      expect(findBarredCopy(body, allBarredPatterns())).toEqual([]);
    }
  });
});

test.describe('canonical policy surface', () => {
  test('/privacy is the one policy page, reachable from every footer', async ({
    page,
  }) => {
    await page.goto('/');
    const link = page.locator('footer a[href="/privacy"]');
    await expect(link).toBeVisible();

    await link.click();
    await expect(page).toHaveURL(/\/privacy$/u);
    await expect(
      page.getByRole('heading', { level: 1, name: /privacy/i })
    ).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      /\/privacy$/u
    );
  });

  test('the policy states retention, deletion, and every processor', async ({
    page,
  }) => {
    await page.goto('/privacy');
    const main = page.locator('main');

    await expect(main).toContainText(/indefinite/i);
    await expect(main).toContainText(/delet/i);
    await expect(main).toContainText('brian@threadplane.ai');
    for (const processor of [
      'Vercel',
      'Neon',
      'PostHog',
      'Resend',
      'Google',
      'Anthropic',
    ]) {
      await expect(main).toContainText(processor);
    }
  });

  test('docs search surfaces no retired library page', async ({ request }) => {
    const response = await request.get('/docs');
    expect(response.ok()).toBe(true);
    expect(await response.text()).not.toMatch(RETIRED_ROUTE_PATTERN);
  });

  test.describe('retired routes', () => {
    for (const route of [
      '/docs/telemetry',
      '/docs/telemetry/getting-started/introduction',
      '/docs/telemetry/guides/privacy-and-opt-out',
      '/api/markdown/telemetry',
      '/api/markdown/telemetry/reference/events',
    ]) {
      test(`${route} redirects permanently to the policy`, async ({
        request,
      }) => {
        const response = await request.get(route, { maxRedirects: 0 });
        expect(response.status()).toBe(308);
        expect(response.headers()['location']).toContain('/privacy');
      });
    }
  });
});
