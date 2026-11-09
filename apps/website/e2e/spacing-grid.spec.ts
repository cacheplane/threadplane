import { expect, test } from '@playwright/test';
import { frameworkControl } from './fixtures/framework-controls';

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

    await page.goto('/docs/angular/langgraph/guides/streaming');
    const picker = await frameworkControl(page);
    await expect(picker).toBeVisible();
    const library = page.locator('.docs-sidebar-library:not(.docs-framework-dropdown) .docs-sidebar-lib-trigger:visible');
    for (const control of [picker, library]) {
      await expect(control).toHaveCSS('min-height', '44px');
      const bounds = await control.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      expect(bounds?.height).toBeLessThan(45);
    }
    await expect(page.locator('.website-workspace-frontend')).toHaveCount(0);
    if (width < 1024) await page.keyboard.press('Escape');
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-workspace-navigation-layout', 'toolbar');
    await expect(page.locator('[data-control-plane-rail]')).toHaveCount(0);
    const toolbar = page.locator('[data-workspace-toolbar]');
    await expect(toolbar).toBeVisible();
    await expect(toolbar).toHaveCSS('padding-left', width < 768 ? '16px' : width < 1024 ? '24px' : '32px');
    for (const mode of await toolbar.locator('[data-workspace-toolbar-mode]').all()) {
      await expect(mode).toHaveCSS('min-height', width < 768 ? '44px' : '36px');
    }
    if (width >= 1024) {
      const search = page.locator('.docs-control-plane-search-trigger');
      await expect(search).toBeVisible();
      await expect(search).toHaveCSS('min-height', '44px');
      await expect(search).toHaveCSS('padding-left', '12px');
    }
  });
}

test('generated API mode uses the same article padding as its reading view', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/docs/angular/langgraph/guides/streaming');
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-hydrated', 'true');
  const reading = page.locator('.docs-article-layout article');
  await expect(reading).toBeVisible();
  await expect(reading).toHaveCSS('padding-top', '48px');
  await expect(reading).toHaveCSS('padding-left', '32px');
  await page.goto('/docs/angular/langgraph/guides/streaming?mode=api');
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-hydrated', 'true');
  const mode = page.getByRole('region', { name: 'API workspace panel', exact: true });
  await expect(mode).toBeVisible();
  const article = mode.locator('.api-reference-page');
  await expect(article.getByRole('heading', { name: 'API reference', exact: true })).toBeVisible();
  await expect(article).toHaveCSS('padding-top', '48px');
  await expect(article).toHaveCSS('padding-left', '32px');
});

for (const width of [768, 1024, 1440]) {
  test(`pricing service bands line up at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/pricing');
    await page.evaluate(() => document.fonts.ready);
    const bands = await page.locator('.pricing-service-card').evaluateAll(cards => {
      const top = cards[0].getBoundingClientRect().top;
      return cards.filter(card => Math.abs(card.getBoundingClientRect().top - top) < 1).map(card =>
        ['.pricing-service-promise', '.pricing-service-description', 'ul', '.pricing-service-action']
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

for (const route of ['/docs/angular/chat/getting-started/quickstart', '/docs/api/langgraph/injectAgent']) {
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
  '/solutions', '/solutions/compliance', '/solutions/analytics', '/solutions/customer-support', '/about', '/contact', '/privacy',
  '/pilot-to-prod', '/blog', '/blog/threadplane-0-3-0',
  '/docs/angular/chat/getting-started/quickstart', '/docs/api/langgraph/injectAgent', '/docs/api', '/docs/api/react',
  '/docs/angular/langgraph/guides/streaming?mode=api',
  '/docs/angular/langgraph/guides/streaming?mode=code',
  '/docs/react/langgraph/guides/streaming',
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
        const filterToggle = page.locator('.api-reference-filters').getByRole('button', { name: /^Filters/ });
        if (await filterToggle.isVisible()) await filterToggle.click();
        const filters = page.locator('.api-reference-filters input, .api-reference-filters .docs-select-trigger');
        await expect(filters).toHaveCount(4);
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
        // Compact Angular navigation deliberately uses optical spacing outside
        // the site's 4px content grid. Pin those authored values rather than
        // exempting the toolbar/sidebar from the spacing audit altogether.
        const compact = '[data-docs-navigation-compact]';
        const opticalSpacing: [string, Record<string, number>][] = [
          // The windowed API sidebar reserves more room for its scrollable exports.
          [`${compact}:has(.api-reference-navigation) .docs-control-plane-search-trigger`, { 'margin-bottom': 12 }],
          [`${compact} .api-scope-picker .docs-sidebar-library`, { 'margin-bottom': 0 }],
          [`${compact} .docs-control-plane-search-trigger`, { 'padding-top': 10, 'padding-bottom': 10, 'margin-bottom': 22 }],
          [`${compact} [data-framework-selector] > label, ${compact} .docs-sidebar-picker-label`, { 'margin-bottom': 6, 'margin-left': 3 }],
          [`${compact} .docs-sidebar-lib-trigger`, { 'padding-top': 10, 'padding-bottom': 10 }],
          [`${compact} .docs-sidebar-library:not(.docs-framework-dropdown)`, { 'margin-bottom': 26 }],
          [`${compact} .docs-sidebar-section`, { 'margin-bottom': 10 }],
          [`${compact} .docs-sidebar-section-toggle, ${compact} .docs-sidebar-section-link, ${compact} .docs-sidebar-top-link`, { 'padding-right': 10, 'padding-left': 10 }],
          [`${compact} .docs-sidebar-section-links`, { 'padding-left': 9, 'margin-top': 3, 'margin-bottom': 6, 'margin-left': 10 }],
          [`${compact}:not([data-mobile]) .docs-sidebar-section-link`, { 'padding-top': 7, 'padding-bottom': 7 }],
          ['[data-workspace-toolbar-mode]', { 'padding-top': 6, 'padding-bottom': 6, 'row-gap': 7, 'column-gap': 7 }],
          ['[data-workspace-toolbar-context] ol, [data-workspace-toolbar-context] li', { 'row-gap': 10, 'column-gap': 10 }],
          ...(window.innerWidth < 768 ? [
            ['[data-workspace-toolbar-mode]', { 'padding-left': 6, 'padding-right': 6 }] as [string, Record<string, number>],
          ] : []),
        ];
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
            const optical = opticalSpacing.find(([selector, values]) =>
              element.matches(selector) && property in values
            );
            const value = parseFloat(style.getPropertyValue(property));
            if (optical) {
              if (value !== optical[1][property]) {
                violations.add(`${optical[0]}: ${property}=${value}, expected ${optical[1][property]}`);
              }
              continue;
            }
            const authored = typed.get(property)?.toString() ?? '';
            if (authored === 'auto' || authored.includes('%')) continue;
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
