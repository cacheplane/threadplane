import { expect, test } from '@playwright/test';

const quickstart = '/docs/angular/chat/getting-started/quickstart';

for (const width of [320, 390, 768, 1440]) {
  test(`API window navigation supports drill-down, scope changes and keyboard at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/docs/api');
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
      'data-hydrated',
      'true'
    );
    const open = page.getByRole('button', {
      name: width < 768 ? 'Open navigation' : 'Open context',
      exact: true,
    });
    if (width < 1024) await open.click();
    const nav = page.getByRole('navigation', {
      name: 'API reference',
      exact: true,
    });
    await expect(nav.locator('details')).toHaveCount(0);
    await expect(nav.locator('[data-api-panel]')).toHaveCount(1);
    await nav.getByRole('button', { name: 'Chat', exact: true }).click();
    const entry = nav.getByRole('button', {
      name: '@threadplane/react/chat',
      exact: true,
    });
    await entry.scrollIntoViewIfNeeded();
    const previousScroll = await nav
      .locator('.api-navigation-items')
      .evaluate((el) => el.scrollTop);
    await entry.click();
    await expect(page).toHaveURL('/docs/api');
    await expect(
      nav.getByRole('searchbox', { name: 'Filter exports' })
    ).toBeVisible();
    const panelBounds = await nav.locator('[data-api-panel]').boundingBox();
    expect(panelBounds).not.toBeNull();
    expect(
      (panelBounds?.y ?? 0) + (panelBounds?.height ?? 0)
    ).toBeLessThanOrEqual(844);
    await expect(nav.locator('[data-api-panel]')).toHaveCSS(
      'animation-name',
      'none'
    );
    const exportList = nav.locator('.api-navigation-items');
    const exportScroll = await exportList.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      return {
        top: el.scrollTop,
        client: el.clientHeight,
        height: el.scrollHeight,
      };
    });
    expect(exportScroll.height).toBeGreaterThan(exportScroll.client);
    expect(exportScroll.top).toBeGreaterThan(0);
    await expect(
      nav.getByRole('button', { name: 'Back to Chat', exact: true })
    ).toBeInViewport();
    await nav
      .getByRole('button', { name: 'Back to Chat', exact: true })
      .click();
    await expect(entry).toBeFocused();
    expect(
      Math.abs(
        (await nav
          .locator('.api-navigation-items')
          .evaluate((el) => el.scrollTop)) - previousScroll
      )
    ).toBeLessThanOrEqual(1);
    await page.keyboard.press('ArrowLeft');
    await expect(
      nav.getByRole('button', { name: 'Chat', exact: true })
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await entry.click();
    const search = nav.getByRole('searchbox', { name: 'Filter exports' });
    await search.fill('no-such-export');
    await page.keyboard.press('Home');
    await expect(search).toBeFocused();
    await expect(nav.getByText('No matching exports.')).toBeVisible();
    await page.locator('[data-api-scope]:visible').click();
    await page
      .getByRole('menuitemradio', { name: 'Angular', exact: true })
      .click();
    await expect(nav.locator('[data-api-panel]')).toHaveAttribute(
      'data-api-panel',
      'libraries'
    );
    await expect(nav.getByRole('searchbox')).toHaveCount(0);
    await nav.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(
      nav.getByRole('button', { name: '@threadplane/react/chat', exact: true })
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBe(width);
    if (width < 1024) {
      await page.keyboard.press('Escape');
      await expect(open).toBeFocused();
    }
  });
}

for (const width of [390, 1440]) {
  test(`API filtering and navigation stay usable in the docs theme at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/docs/api');
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
      'data-hydrated',
      'true'
    );
    const filters = page.locator('.api-reference-filters');
    await filters.getByLabel('Find an API').fill('useAgent');
    if (width < 768)
      await filters.getByRole('button', { name: /^Filters/ }).click();
    await filters
      .getByRole('button', { name: 'Framework', exact: true })
      .click();
    await filters
      .getByRole('menuitemradio', { name: 'React', exact: true })
      .click();
    await expect(page).toHaveURL(/apiFramework=react/);
    const reference = page.locator('.api-reference-page');
    await expect(
      reference.getByRole('link', { name: 'useAgent', exact: true })
    ).toHaveAttribute('href', '/docs/api/react/useAgent');
    await reference
      .getByRole('link', { name: 'useAgent', exact: true })
      .click();
    await expect(page).toHaveURL('/docs/api/react/useAgent');
    await expect(
      page.getByRole('heading', { level: 1, name: 'useAgent', exact: true })
    ).toBeVisible();
    await expect(page.locator('.api-reference-code').first()).toBeVisible();
    if (width < 1024)
      await page
        .getByRole('button', { name: 'Open navigation', exact: true })
        .click();
    await expect(page.locator('[data-api-scope]:visible')).toHaveAttribute(
      'data-api-scope',
      'react'
    );
    const navigation = page.getByRole('navigation', {
      name: 'API reference',
      exact: true,
    });
    await expect(
      navigation.getByRole('link', { name: 'useAgent', exact: true })
    ).toHaveAttribute('aria-current', 'page');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBe(width);
  });
}

test('API scope stays synchronized through the workspace registrar, refresh and history', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/docs/api?keep=yes#reference');
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-hydrated',
    'true'
  );
  const framework = page
    .locator('.api-reference-filters')
    .getByLabel('Framework', { exact: true });
  await framework.click();
  await page
    .locator('.api-reference-filters')
    .getByRole('menuitemradio', { name: 'React', exact: true })
    .click();
  await expect(page.locator('[data-api-scope]')).toHaveAttribute(
    'data-api-scope',
    'react'
  );
  await page.locator('[data-api-scope]').click();
  await page
    .getByRole('menuitemradio', { name: 'Angular', exact: true })
    .click();
  await expect(framework).toHaveText('Angular');
  await expect(page).toHaveURL(/keep=yes&apiFramework=angular#reference/);
  await page.goBack();
  await expect(framework).toHaveText('React');
  await expect(page.locator('[data-api-scope]')).toHaveAttribute(
    'data-api-scope',
    'react'
  );
  await page.goForward();
  await expect(framework).toHaveText('Angular');
  await page.reload();
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-hydrated',
    'true'
  );
  await expect(framework).toHaveText('Angular');
  await expect(page.locator('[data-api-scope]')).toHaveAttribute(
    'data-api-scope',
    'angular'
  );
});

test('mobile API filters disclose accessibly and preserve the selected scope', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/docs/api');
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-hydrated',
    'true'
  );
  const filters = page.locator('.api-reference-filters');
  const toggle = filters.getByRole('button', { name: /^Filters/ });
  await expect(filters.getByLabel('Framework', { exact: true })).toBeHidden();
  const firstResult = await page
    .locator('.api-reference-entrypoint-card')
    .first()
    .boundingBox();
  if (!firstResult) throw new Error('Missing first API result');
  expect(firstResult.y).toBeLessThan(844);
  await toggle.focus();
  await page.keyboard.press('Enter');
  await filters.getByRole('button', { name: 'Framework', exact: true }).click();
  await filters
    .getByRole('menuitemradio', { name: 'React', exact: true })
    .click();
  await toggle.click();
  await expect(filters.getByLabel('Framework', { exact: true })).toBeHidden();
  await expect(toggle).toBeFocused();
  await filters.getByLabel('Find an API').fill('no-such-export');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(filters.getByLabel('Find an API')).toBeFocused();
  await expect(page.locator('.api-reference-result-count')).toContainText(
    'React'
  );
  await page
    .getByRole('button', { name: 'Open navigation', exact: true })
    .click();
  await expect(page.locator('[data-api-scope]:visible')).toHaveAttribute(
    'data-api-scope',
    'react'
  );
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Open navigation', exact: true })
  ).toBeFocused();
});

for (const width of [320, 390, 768, 1024, 1440, 1920]) {
  test(`API and docs share a reading edge at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(quickstart);
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
      'data-hydrated',
      'true'
    );
    const docsLeft = await page
      .locator('.docs-prose')
      .evaluate((el) => el.getBoundingClientRect().left);
    for (const route of ['/docs/api', '/docs/api/langgraph/injectAgent']) {
      await page.goto(route);
      await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
        'data-hydrated',
        'true'
      );
      const apiLeft = await page
        .locator('.api-reference-page')
        .evaluate(
          (el) =>
            el.getBoundingClientRect().left +
            parseFloat(getComputedStyle(el).paddingLeft)
        );
      expect(Math.abs(apiLeft - docsLeft), route).toBeLessThanOrEqual(1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth)
      ).toBe(width);
    }
  });
}

for (const width of [390, 1440]) {
  test(`Quick Start hydrates with valid card links at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        /hydrat|cannot.*descendant|cannot contain a nested/i.test(
          message.text()
        )
      ) {
        errors.push(message.text());
      }
    });
    await page.goto(quickstart);
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
      'data-hydrated',
      'true'
    );
    const card = page
      .getByRole('region', { name: 'Docs workspace panel', exact: true })
      .locator('[data-mdx="card"]')
      .filter({ hasText: 'Going to production' });
    await card.scrollIntoViewIfNeeded();
    await expect(
      card.getByRole('link', { name: 'Going to production', exact: false })
    ).toHaveAttribute(
      'href',
      '/docs/angular/chat/getting-started/installation'
    );
    await expect(
      card.getByRole('link', { name: 'Installation', exact: true })
    ).toHaveAttribute(
      'href',
      '/docs/angular/chat/getting-started/installation'
    );
    await expect(
      card.getByRole('link', { name: 'Agent deployment', exact: true })
    ).toHaveAttribute('href', '/docs/angular/langgraph/guides/deployment');
    expect(errors).toEqual([]);
    await card
      .getByRole('link', { name: 'Agent deployment', exact: true })
      .click();
    await expect(page).toHaveURL(
      /\/docs\/angular\/langgraph\/guides\/deployment$/
    );
    await page.goto(quickstart);
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
      'data-hydrated',
      'true'
    );
    await card.scrollIntoViewIfNeeded();
    const box = await card.boundingBox();
    if (!box) throw new Error('Missing production card bounds');
    // Clicking card padding must still follow the primary destination.
    await card.click({ position: { x: box.width - 12, y: box.height - 12 } });
    await expect(page).toHaveURL(
      /\/docs\/angular\/chat\/getting-started\/installation$/
    );
  });
}
