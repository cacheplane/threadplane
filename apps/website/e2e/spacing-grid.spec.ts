import { expect, test } from '@playwright/test';

for (const width of [375, 768, 1024, 1440, 1920]) {
  test(`shared page edges and controls align at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    const edges = await page.evaluate(() => {
      const content = document.querySelector('main [data-ui="container"]');
      const footer = document.querySelector('.footer-root > div');
      if (!content || !footer) throw new Error('Missing page containers');
      const edge = (e: Element) => {
        const r = e.getBoundingClientRect(), s = getComputedStyle(e);
        return { left: r.left + parseFloat(s.paddingLeft), right: r.right - parseFloat(s.paddingRight) };
      };
      return { content: edge(content), footer: edge(footer) };
    });
    expect(Math.abs(edges.footer.left - edges.content.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(edges.footer.right - edges.content.right)).toBeLessThanOrEqual(1);

    await page.goto('/docs/langgraph/guides/streaming');
    const picker = page.getByRole('combobox', { name: 'Example UI' });
    await expect(picker).toBeVisible();
    await expect(picker).toHaveCSS('height', width < 768 ? '44px' : '36px');
    await expect(page.locator('.website-workspace-frontend')).toHaveCSS('height', width < 768 ? '64px' : '56px');
    await expect(page.locator('[data-workspace-surface] > header')).toHaveCSS('height', width < 1024 ? '72px' : '48px');
    if (width >= 1024) {
      const search = page.locator('.docs-control-plane-search-trigger');
      await expect(search).toBeVisible();
      await expect(search).toHaveCSS('height', '36px');
      await expect(search).toHaveCSS('padding-left', '12px');
    }
  });
}

test('API mode uses the same article inset as its reading view', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/docs/langgraph/guides/streaming?mode=api');
  const mode = page.getByRole('region', { name: 'API mode', exact: true });
  // API mode is a labelled section, exposed as a region by the browser.
  await expect(mode).toBeVisible();
  const heading = mode.locator('.workspace-api-heading').first();
  await expect(heading).toBeVisible();
  const inset = await heading.evaluate((el) => {
    const panel = el.closest('[aria-label="API mode"]');
    if (!panel) throw new Error('Missing API panel');
    const r = el.getBoundingClientRect(), p = panel.getBoundingClientRect();
    return { top: r.top - p.top, left: r.left - p.left };
  });
  expect(inset).toEqual({ top: 48, left: 32 });
});

for (const width of [768, 1024, 1440]) {
  test(`pricing comparison bands line up at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/pricing');
    await page.evaluate(() => document.fonts.ready);
    const bands = await page.locator('.pricing-plan-card').evaluateAll(cards => {
      const top = cards[0].getBoundingClientRect().top;
      return cards.filter(card => Math.abs(card.getBoundingClientRect().top - top) < 1).map(card =>
        ['.pricing-plan-price-block', '.pricing-plan-description', '.pricing-plan-feature-list', '.pricing-plan-action']
          .map(selector => card.querySelector(selector)?.getBoundingClientRect().top ?? 0)
      );
    });
    expect(bands.length).toBeGreaterThan(1);
    for (const band of bands.slice(1)) {
      for (let i = 0; i < band.length; i++) expect(Math.abs(band[i] - bands[0][i])).toBeLessThanOrEqual(1);
    }
  });
}

test('long generated API names stay inside their article on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  for (const path of [
    '/docs/api/langgraph/provideAgent',
    '/docs/api/render/defineAngularRegistry',
    '/docs/api/langgraph/LangGraphThreadsAdapter',
  ]) {
    await page.goto(path);
    const name = page.locator('.api-reference-detail > h1').first();
    await expect(name).toBeVisible();
    const bounds = await name.evaluate(el => {
      const header = el.closest('.api-reference-detail');
      if (!header) throw new Error('Missing API article');
      const parent = header.getBoundingClientRect();
      return [...header.querySelectorAll(':scope > h1, :scope > .api-reference-meta')].map(child => {
        const r = child.getBoundingClientRect();
        return { left: r.left - parent.left, right: r.right - parent.right };
      });
    });
    for (const child of bounds) {
      expect(child.left, path).toBeGreaterThanOrEqual(0);
      expect(child.right, path).toBeLessThanOrEqual(1);
    }
  }
});

for (const route of ['/docs/chat/getting-started/quickstart', '/docs/api/langgraph/injectAgent']) {
  test(`code copy buttons sit inside their code block on ${route}`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(route);
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-hydrated', 'true');
    const block = page.locator('.mdx-pre-wrap').first();
    await expect(block).toBeVisible();
    const offsets = await block.evaluate(el => {
      const pre = el.querySelector('pre')?.getBoundingClientRect();
      const button = el.querySelector('button')?.getBoundingClientRect();
      if (!pre || !button) throw new Error('Missing code/copy button');
      return { top: button.top - pre.top, right: pre.right - button.right, bottom: pre.bottom - button.bottom };
    });
    expect(offsets.top).toBe(8);
    expect(offsets.right).toBe(8);
    expect(offsets.bottom).toBeGreaterThanOrEqual(0);
  });
}

// Grid audit uses authored/computed values, not used auto margins. A centred
// fluid column can start at a fractional pixel without violating its spacing.
const ROUTES = [
  '/', '/docs', '/chat', '/langgraph', '/ag-ui', '/render', '/pricing',
  '/solutions', '/solutions/compliance', '/about', '/contact', '/privacy',
  '/pilot-to-prod', '/blog', '/blog/threadplane-0-3-0',
  '/docs/chat/getting-started/quickstart', '/docs/api/langgraph/injectAgent', '/docs/api', '/docs/api/react',
  '/docs/langgraph/guides/streaming?mode=api',
  '/docs/langgraph/guides/streaming?mode=code',
  '/docs/langgraph/guides/streaming?frontend=react',
];

for (const width of [320, 375, 768, 1024, 1440, 1920]) {
  test(`page families use grid spacing without page overflow at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    for (const route of ROUTES) {
      const response = await page.goto(route);
      expect(response?.status(), route).toBe(200);
      if (route.startsWith('/docs/')) {
        await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-hydrated', 'true');
      }
      await page.evaluate(() => document.fonts.ready);
      if (route === '/docs/api') {
        const filters = page.locator('.api-reference-filters input, .api-reference-filters select');
        expect(await filters.count()).toBeGreaterThan(1);
        for (const control of await filters.all()) {
          await expect(control).toHaveCSS('height', '44px');
        }
      }
      const audit = await page.evaluate(() => {
        const properties = [
          'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
          'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
          'row-gap', 'column-gap',
        ];
        const violations = new Set<string>();
        for (const element of document.querySelectorAll('body *')) {
          // Inline ink, glyphs and authored diagram coordinate systems are
          // optical geometry. Embedded apps have their own consumer styling.
          if (element.closest('svg, iframe, code, nextjs-portal, .marker-highlight, .tp-diagram-figure, .arch-figure, .arch-flow-card')) continue;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          if (!rect.width || !rect.height || style.visibility === 'hidden') continue;
          const typed = (element as Element & {
            computedStyleMap(): { get(name: string): { toString(): string } | undefined };
          }).computedStyleMap();
          for (const property of properties) {
            const authored = typed.get(property)?.toString() ?? '';
            if (authored === 'auto' || authored.includes('%')) continue;
            const value = parseFloat(style.getPropertyValue(property));
            // 1px/2px rules and dense separators stay legal. Allow 0.08px of
            // browser rounding; this is not a text-baseline or width test.
            if (!Number.isFinite(value) || Math.abs(value) <= 2 ||
                Math.abs(value / 4 - Math.round(value / 4)) <= 0.02) continue;
            violations.add(`${element.getAttribute('data-ui') ?? element.className ?? element.tagName}: ${property}=${value}`);
          }
        }
        return { violations: [...violations], pageWidth: document.documentElement.scrollWidth };
      });
      expect(audit.violations, route).toEqual([]);
      expect(audit.pageWidth, route).toBe(width);
    }
  });
}
