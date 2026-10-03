import { test, expect } from '@playwright/test';

test.describe('Docs landing page', () => {
  test('renders the start-here funnel + search prompt', async ({ page }) => {
    await page.goto('/docs');

    // Hero
    await expect(page.locator('#docs-heading')).toBeVisible();
    await expect(page.locator('#docs-heading')).toContainText('Start building with Threadplane');

    // Step headings (match the label text; the numbered badge is a separate aria-hidden span)
    await expect(page.getByText('Pick your backend').first()).toBeVisible();
    await expect(page.getByText('Generative UI').first()).toBeVisible();
    await expect(page.getByText('Chat UI').first()).toBeVisible();

    // Step 1 — backend quickstart links
    await expect(page.locator('main a[href="/docs/langgraph/getting-started/quickstart"]').first()).toBeVisible();
    await expect(page.locator('main a[href="/docs/ag-ui/getting-started/quickstart"]').first()).toBeVisible();

    // Vendor logo marks on the fork cards
    await expect(page.locator('main img[src="/logos/langgraph.svg"]').first()).toBeVisible();
    await expect(page.locator('main img[src="/logos/ag-ui.svg"]').first()).toBeVisible();
    await expect(page.locator('main img[src="/logos/providers/google.svg"]').first()).toBeVisible();
    await expect(page.locator('main img[src="/logos/surface/vercel.svg"]').first()).toBeVisible();

    // Install snippet copy buttons
    await expect(page.locator('main button[aria-label="Copy install command"]').first()).toBeVisible();

    // Step 2 — generative UI links
    await expect(page.locator('main a[href="/docs/a2ui/getting-started/introduction"]').first()).toBeVisible();
    await expect(page.locator('main a[href="/docs/render/getting-started/introduction"]').first()).toBeVisible();

    // Step 3 — chat
    await expect(page.locator('main a[href="/docs/chat/getting-started/introduction"]').first()).toBeVisible();

    // Helper links
    await expect(page.locator('main a[href="/docs/choosing-an-adapter"]').first()).toBeVisible();
    await expect(page.locator('main a[href="/docs/render/concepts/json-render-vs-a2ui"]').first()).toBeVisible();

    // The retired telemetry library must not reappear as a card.
    await expect(page.locator('main a[href^="/docs/telemetry"]')).toHaveCount(0);

    // Search prompt
    await expect(page.getByText('Looking for something specific?').first()).toBeVisible();
  });
});

test.describe('Docs slug page', () => {
  const route = '/docs/langgraph/getting-started/introduction';

  test('keeps page scroll fixed when focusing the last control-plane nav link', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto(route);

    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
      'data-hydrated',
      'true',
    );

    const pane = page.locator(
      '[data-workspace-desktop-navigation] [data-control-plane-pane]',
    );
    // Search moved to the top of the pane (was the bottom Actions-bar item
    // this test used to focus), so it can no longer stand in for "something
    // near the bottom of the scrollable pane". The last link in the Learn
    // section tree still sits at the bottom of the pane's content and is
    // rendered on every docs page, so it exercises the same bug class: focus
    // deep in the pane must scroll the pane, not the window.
    const lastNavLink = pane.locator('.docs-sidebar-section-link').last();
    await expect(pane).toBeVisible();
    await expect(lastNavLink).toBeVisible();
    await pane.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.evaluate(() => window.scrollTo(0, 0));

    await lastNavLink.focus();

    await expect.poll(() => pane.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('renders breadcrumb + h1 + sidebar', async ({ page }) => {
    await page.goto(route);
    await expect(page.locator('aside').first()).toBeVisible();
    await expect(page.locator('nav[aria-label="Breadcrumb"]').first()).toBeVisible();
    await expect(page.locator('article').first()).toBeVisible();
  });

  test('renders the branded chrome (sidebar mark, breadcrumb trail, prev/next direction)', async ({ page }) => {
    await page.goto(route);
    // Sidebar shows the active library's logo mark
    await expect(page.locator('aside img[src="/logos/langgraph.svg"]').first()).toBeVisible();
    // The lib · section label moved into the shell's breadcrumb trail.
    const breadcrumb = page.locator('nav[aria-label="Breadcrumb"]').first();
    await expect(breadcrumb).toContainText('LangGraph');
    await expect(breadcrumb).toContainText('Getting Started');
    // Prev/Next: introduction is the first page, so a "Next →" card is present
    await expect(page.getByText('Next →').first()).toBeVisible();
    // Per-page LLM actions trigger
    await expect(page.locator('main button[aria-label="Page actions"]').first()).toBeVisible();
  });

  test('breadcrumb shows the library + page title', async ({ page }) => {
    await page.goto(route);
    const breadcrumb = page.locator('nav[aria-label="Breadcrumb"]').first();
    await expect(breadcrumb).toContainText('Docs');
  });

  test('renders DocsPrevNext at the bottom (next-only for the first page)', async ({ page }) => {
    await page.goto(route);
    const prevNext = page.locator('nav[aria-label="Previous and next page"]').first();
    await expect(prevNext).toBeVisible();
  });

  test('headings have ID anchors for hash links', async ({ page }) => {
    await page.goto(route);
    const h2 = page.locator('article h2').first();
    await expect(h2).toBeVisible();
    const id = await h2.getAttribute('id');
    expect(id).toBeTruthy();
    expect(id?.length).toBeGreaterThan(0);
  });

  test('heading permalinks carry no glyph in the text, only a CSS ::before', async ({ page }) => {
    await page.goto(route);

    // The workspace shell re-renders the article on hydration; before that,
    // computed styles on its subtree can read as empty on a cold CI server.
    // Same gate the control-plane tests above use.
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
      'data-hydrated',
      'true',
    );

    const h2 = page.locator('article h2').first();
    await expect(h2).toBeVisible();

    // The `#` must never be a text node: extracted heading text feeds search
    // snippets, the page outline, and anything summarizing the DOM.
    expect((await h2.textContent())?.trim()).not.toContain('#');

    // ...which means the visible affordance hangs entirely on one CSS rule
    // (`.docs-prose h2 .heading-anchor::before` in global.css). jsdom cannot
    // resolve pseudo-element content, so this is the only place it is guarded.
    // Poll: stylesheet application can trail hydration on a cold dev server.
    const anchor = h2.locator('a.heading-anchor');
    await expect(anchor).toHaveCount(1);
    await expect
      .poll(() =>
        anchor.evaluate((el) => getComputedStyle(el, '::before').content)
      )
      .toBe('"#"');
  });

  test('breadcrumb renders exactly once', async ({ page }) => {
    await page.goto('/docs/langgraph/getting-started/introduction');
    await expect(page.locator('nav[aria-label="Breadcrumb"]')).toHaveCount(1);
  });

  test('finds a term that appears only in body prose and lands on its section', async ({ page }) => {
    // Desktop breakpoint: the "Search docs" control-plane button is directly
    // visible without opening the mobile navigation dialog first (see
    // workspace-shell.spec.ts's desktop-rail tests).
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(route);

    // Open by clicking the trigger, matching workspace-shell.spec.ts. A
    // keyboard shortcut would depend on how the runner maps Meta, and the
    // button is the affordance a real user has anyway. The control may also
    // exist in the mobile drawer's DOM, so scope to the first match.
    await page.getByRole('button', { name: 'Search docs' }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Search documentation' });
    await expect(dialog).toBeVisible();

    // "checkpointer" is prose inside the persistence guide (7 occurrences
    // outside fenced code) and is in no page title anywhere in
    // docs-config.ts, so a title-only search returns nothing for it. This
    // only passes if server-side content search is genuinely wired up.
    await dialog
      .getByRole('combobox', { name: 'Search documentation...' })
      .fill('checkpointer');

    const hit = dialog.getByRole('option').filter({ hasText: /checkpointer/i }).first();
    await expect(hit).toBeVisible({ timeout: 10000 });

    // Prove the match came from server-side content search, not the instant
    // client-side title matcher: it must sit under the "In page content"
    // group, and its own row must show a snippet containing the term (a
    // future regression that merely surfaced a title match must not keep
    // this green).
    await expect(dialog.getByText('In page content')).toBeVisible();
    await expect(hit.locator('.docs-search-result-snippet')).toContainText(/checkpointer/i);

    await hit.click();

    // The deep link must land on a real section anchor, not just a
    // well-formed but dangling fragment that scrolls nowhere.
    await expect(page).toHaveURL(/\/docs\/[a-z0-9-]+\/.*#.+/);
    const url = new URL(page.url());
    expect(url.hash.length).toBeGreaterThan(1);
    await expect(page.locator(url.hash)).toBeVisible();
  });

  test('search shows the empty state for a term that appears nowhere in the docs', async ({ page }) => {
    // Negative control: without this, a matcher that returns everything for
    // everything would make the content-hit test above pass by accident.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(route);

    await page.getByRole('button', { name: 'Search docs' }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Search documentation' });
    await expect(dialog).toBeVisible();

    // Confirmed absent from the whole docs content/config tree via grep.
    await dialog
      .getByRole('combobox', { name: 'Search documentation...' })
      .fill('zqxvantibrackle');

    await expect(dialog.getByText('No results found')).toBeVisible({ timeout: 10000 });
    await expect(dialog.getByRole('option')).toHaveCount(0);
  });
});

test.describe('a2ui docs', () => {
  test('quickstart renders with sidebar + article', async ({ page }) => {
    await page.goto('/docs/a2ui/getting-started/quickstart');
    await expect(page.locator('aside').first()).toBeVisible();
    await expect(page.locator('article').first()).toBeVisible();
    await expect(page.locator('article h1').first()).toContainText('Quick Start');
  });

  test('sidebar lists the new guides', async ({ page }) => {
    await page.goto('/docs/a2ui/getting-started/quickstart');
    await expect(page.locator('aside').getByText('Message Protocol').first()).toBeVisible();
    await expect(page.locator('aside').getByText('Data Model').first()).toBeVisible();
    await expect(page.locator('aside').getByText('Validating & Adapting').first()).toBeVisible();
  });
});

test.describe('Docs search', () => {
  test('Cmd+K opens the search modal', async ({ page, browserName }) => {
    await page.goto('/docs/langgraph/getting-started/introduction');
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
      'data-hydrated',
      'true'
    );
    // Mac uses Meta; other platforms emulate the same shortcut via keydown.
    const modifier = browserName === 'webkit' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+KeyK`);
    // The modal mounts somewhere — assert by visible input role with placeholder text.
    await expect(page.locator('input[placeholder*="Search"], input[type="search"]').first()).toBeVisible({ timeout: 3000 });
  });

  test('matches docs pages when query omits small connector words', async ({ page, browserName }) => {
    await page.goto('/docs/langgraph/getting-started/introduction');
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
      'data-hydrated',
      'true'
    );
    const modifier = browserName === 'webkit' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+KeyK`);

    const searchInput = page.locator('input[placeholder*="Search"], input[type="search"]').first();
    await searchInput.fill('choosing adapter');

    // Search results are role="option" inside the listbox (a11y pass, #865) —
    // an explicit ARIA role overrides the implicit button role.
    await expect(page.getByRole('option', { name: /Choosing an adapter/i })).toBeVisible();
    await expect(page.getByText('No results found')).toHaveCount(0);
  });
});

test.describe('Retired telemetry docs library', () => {
  for (const route of [
    '/docs/telemetry',
    '/docs/telemetry/getting-started/introduction',
    '/api/markdown/telemetry',
    '/api/markdown/telemetry/getting-started/introduction',
  ]) {
    test(`redirects ${route} to the canonical policy`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/privacy$/u);
      await expect(
        page.getByRole('heading', { level: 1, name: /privacy/i })
      ).toBeVisible();
    });
  }
});
