import { chromium, type FullConfig } from '@playwright/test';

/**
 * Playwright globalSetup for local runs against `next dev`, which compiles
 * each route (and the client chunks it loads lazily) on first request.
 * With several workers, the first tests all hit uncompiled routes at once;
 * the compiles then compete for CPU and a hydration, frame or framework-switch
 * check misses its window. Readiness of the dev server's port says nothing
 * about that, so this visits the shared docs route once, in every workspace
 * mode and both frameworks, before any worker starts.
 */
const pages = [
  '/',
  '/docs/angular/deep-agents/capabilities/memory',
  '/docs/react/deep-agents/capabilities/memory',
  '/docs/react/deep-agents/capabilities/memory?mode=code',
  '/docs/react/deep-agents/capabilities/memory?mode=run',
];

export default async function warmUp(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const path of pages) {
      await page.goto(new URL(path, baseURL).toString(), {
        waitUntil: 'load',
        timeout: 300_000,
      });
      const shell = page.locator('[data-workspace-shell]');
      if (await shell.count())
        await shell.waitFor({ state: 'attached', timeout: 300_000 });
      await page
        .locator('[data-workspace-shell][data-hydrated="true"]')
        .or(page.locator('body:not(:has([data-workspace-shell]))'))
        .first()
        .waitFor({ timeout: 300_000 });
    }
  } finally {
    await browser.close();
  }
}
