import { expect, test } from '@playwright/test';
import {
  chooseFramework,
  frameworkControl,
  selectFramework,
} from './fixtures/framework-controls';

const angular = '/docs/angular/ag-ui/guides/interrupts';
const react = '/docs/react/ag-ui/guides/interrupts';

test('upward library menu stays inside the sidebar in landscape', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 400 });
  await page.goto(angular);
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-hydrated',
    'true'
  );
  await page.locator('[data-docs-library-trigger]:visible').click();
  const menu = page.getByRole('menu', { name: 'Libraries', exact: true });
  await expect(menu).toHaveAttribute('data-side', 'top');
  const bounds = await menu.evaluate((el) => {
    let clipTop = 0;
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY))
        clipTop = Math.max(clipTop, parent.getBoundingClientRect().top);
    }
    return { top: el.getBoundingClientRect().top, clipTop };
  });
  expect(bounds.top).toBeGreaterThanOrEqual(bounds.clipTop + 16);
});

for (const width of [375, 1440]) {
  test(`custom framework picker blocks repeat selection while navigating at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(angular);
    await frameworkControl(page);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let intercepted = false;
    await page.route(
      (url) => url.pathname === react && url.searchParams.has('_rsc'),
      async (route) => {
        intercepted = true;
        await pending;
        await route.continue();
      }
    );
    try {
      await chooseFramework(page, 'react');
      await expect.poll(() => intercepted).toBe(true);
      if (width < 768)
        await page
          .getByRole('button', { name: 'Open navigation', exact: true })
          .click();
      await expect(
        page.locator('[data-framework-control]:visible')
      ).toBeDisabled();
      await expect(
        page.locator('[data-website-workspace-host]')
      ).toHaveAttribute('data-workspace-framework', 'angular');
      release();
      await expect(page).toHaveURL(react, { timeout: 15_000 });
      await expect(await frameworkControl(page)).toBeEnabled();
    } finally {
      release();
    }
  });
}

test('library selection and keyboard focus stay distinct in forced colors', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto(angular);
  await page.locator('[data-docs-library-trigger]:visible').press('Enter');
  const selected = page.getByRole('menuitemradio', { checked: true });
  await expect(selected).toBeFocused();
  const colors = await selected.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      outline: style.outlineColor,
      background: style.backgroundColor,
      width: style.outlineWidth,
    };
  });
  expect(colors.outline).not.toBe(colors.background);
  expect(parseFloat(colors.width)).toBeGreaterThanOrEqual(2);
});

test('Angular search has a visible keyboard focus indicator', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(angular);
  const search = page.getByRole('button', { name: 'Search docs', exact: true });
  await page.keyboard.press('Tab');
  await search.focus();
  await expect(search).toBeFocused();
  expect(
    await search.evaluate((el) => {
      const style = getComputedStyle(el);
      return (
        el.matches(':focus-visible') &&
        ((style.outlineStyle !== 'none' &&
          parseFloat(style.outlineWidth) > 0) ||
          style.boxShadow !== 'none')
      );
    })
  ).toBe(true);
});

test('Angular example tabs have mobile touch targets', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/docs/angular/langgraph/getting-started/quickstart');
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-hydrated',
    'true'
  );
  const tabs = page.locator('.docs-workspace-article .mdx-tab-button:visible');
  await expect(tabs.first()).toBeVisible();
  for (const tab of await tabs.all()) {
    expect((await tab.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
});

test('framework reading treatment stays consistent on Angular and React navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(react);
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-hydrated',
    'true'
  );
  const heading = page.locator('.docs-prose h1');
  await expect(heading).toBeVisible();
  const before = await heading.evaluate((el) => ({
    size: getComputedStyle(el).fontSize,
    color: getComputedStyle(el).color,
  }));
  await selectFramework(page, 'angular');
  await expect(heading).toHaveCSS('font-size', '44px');
  await expect(
    page.locator('[data-mdx="callout"][data-tone="info"]').first()
  ).toHaveCSS('border-radius', '20px');
  await selectFramework(page, 'react');
  await expect(heading).toHaveCSS('font-size', before.size);
  await expect(heading).toHaveCSS('color', before.color);
});

for (const width of [320, 375, 768, 1440]) {
  test(`Angular library picker fits a short window and releases keyboard focus at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 600 });
    await page.goto(angular);
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
      'data-hydrated',
      'true'
    );
    if (width < 1024) await frameworkControl(page);
    const framework = page.getByRole('button', {
      name: 'Framework',
      exact: true,
    });
    await framework.click();
    const frameworkMenu = page.getByRole('menu', {
      name: 'Frameworks',
      exact: true,
    });
    await expect(
      frameworkMenu.getByRole('menuitemradio', { name: 'Angular', exact: true })
    ).toBeFocused();
    await page.keyboard.press('r');
    await expect(
      frameworkMenu.getByRole('menuitemradio', { name: 'React', exact: true })
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(frameworkMenu).not.toBeVisible();
    await expect(framework).toBeFocused();
    const trigger = page.locator('[data-docs-library-trigger]:visible');
    await trigger.click();
    const menu = page.getByRole('menu', { name: 'Libraries', exact: true });
    await expect(
      menu.getByRole('menuitemradio', { checked: true })
    ).toBeFocused();
    const bounds = await menu.boundingBox();
    expect(bounds?.y).toBeGreaterThanOrEqual(0);
    expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(600);
    await page.keyboard.press('End');
    const last = menu.getByRole('menuitemradio').last();
    await expect(last).toBeFocused();
    const lastBounds = await last.boundingBox();
    expect(
      (lastBounds?.y ?? 0) + (lastBounds?.height ?? 0)
    ).toBeLessThanOrEqual((bounds?.y ?? 0) + (bounds?.height ?? 0));
    await page.keyboard.press('c');
    await expect(
      menu.getByRole('menuitemradio', { name: 'Chat', exact: true })
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(menu).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Getting Started', exact: true })
    ).toBeFocused();
    await trigger.click();
    await page.keyboard.press('Shift+Tab');
    await expect(menu).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Framework', exact: true })
    ).toBeFocused();
  });

  test(`Angular menus remain usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(angular);
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
      'data-hydrated',
      'true'
    );
    if (width < 1024) await frameworkControl(page);
    const search = page.getByRole('button', {
      name: 'Search docs',
      exact: true,
    });
    if (width < 1024)
      expect((await search.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    const library = page.locator('[data-docs-library-trigger]:visible');
    await library.press('ArrowDown');
    const menu = page.locator('.docs-sidebar-lib-menu:visible');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitemradio').first()).toBeFocused();
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitemradio').last()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(library).toBeFocused();
    await search.click();
    const dialog = page.getByRole('dialog', { name: 'Search documentation' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox').fill('interrupt');
    await expect(dialog.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    const close = page.getByRole('button', {
      name: 'Close navigation',
      exact: true,
    });
    if (await close.isVisible()) await close.click();
    await page
      .getByRole('button', { name: 'Page actions', exact: true })
      .click();
    const actions = page.locator('.docs-page-actions-menu');
    await expect(actions).toBeVisible();
    const box = await actions.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('button', { name: 'Page actions', exact: true })
    ).toBeFocused();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBe(width);
  });
}
