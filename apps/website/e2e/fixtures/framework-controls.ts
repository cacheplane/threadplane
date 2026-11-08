import { expect, type Page } from '@playwright/test';

/** Framework choices live in the same adaptive navigation on desktop and mobile. */
export async function frameworkControl(page: Page) {
  await expect(
    page.locator('[data-framework-selector]').first()
  ).toBeAttached();
  const visible = page.locator('[data-framework-control]:visible');
  if (!(await visible.count())) {
    const mobile = page.getByRole('button', {
      name: 'Open navigation',
      exact: true,
    });
    if (await mobile.isVisible()) await mobile.click();
    else
      await page
        .getByRole('button', { name: 'Open context', exact: true })
        .click();
  }
  await expect(visible).toBeVisible();
  await expect(visible).toBeEnabled();
  return visible;
}

export async function expectFrameworkControl(page: Page) {
  const openedDrawer = !(await page
    .locator('[data-framework-control]:visible')
    .count());
  await expect(await frameworkControl(page)).toBeVisible();
  if (openedDrawer) {
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-framework-control]:visible')).toHaveCount(
      0
    );
  }
}

/** Choose through the visible control without waiting for a destination. */
export async function chooseFramework(
  page: Page,
  framework: 'angular' | 'react'
) {
  const control = await frameworkControl(page);
  if (await control.evaluate((el) => el.tagName === 'SELECT')) {
    await control.selectOption(framework);
  } else {
    await control.click();
    await page
      .getByRole('menu', { name: 'Frameworks', exact: true })
      .getByRole('menuitemradio', {
        name: framework === 'angular' ? 'Angular' : 'React',
        exact: true,
      })
      .click();
  }
}

/** Wait for route-based selection and disposal before inspecting the new runtime. */
export async function selectFramework(
  page: Page,
  framework: 'angular' | 'react'
) {
  const control = await frameworkControl(page);
  const previous = await control.getAttribute('data-value');
  const frames = page.locator('iframe');
  const oldFrame = (await frames.count())
    ? await frames.first().elementHandle()
    : null;
  await chooseFramework(page, framework);
  // Switching frameworks now loads a server-rendered article. In next dev,
  // cold MDX rendering can outlast the ordinary five-second UI assertion.
  await expect(page).toHaveURL(
    (url) => url.pathname.startsWith(`/docs/${framework}/`),
    { timeout: 15_000 }
  );
  await expect(page.locator('[data-website-workspace-host]')).toHaveAttribute(
    'data-workspace-framework',
    framework
  );
  await expect(
    page.locator('[data-framework-control]').first()
  ).toHaveAttribute('data-value', framework);
  await expect(page.locator('[data-framework-control]').first()).toBeEnabled();
  if (previous !== framework && oldFrame) {
    await expect
      .poll(() => oldFrame.evaluate((element) => element.isConnected))
      .toBe(false);
  }
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-hydrated',
    'true'
  );
  const routeMode = new URL(page.url()).searchParams.get('mode')?.toLowerCase();
  const expectedMode =
    routeMode === 'run'
      ? 'Run'
      : routeMode === 'code'
      ? 'Code'
      : routeMode === 'api'
      ? 'API'
      : 'Docs';
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-workspace-mode',
    expectedMode
  );
  // Development streams MDX after the workspace shell has committed. Wait for
  // the selected article before callers assert its specific heading/content.
  if (expectedMode === 'Docs') {
    await expect(
      page.locator(`[data-docs-framework="${framework}"] h1`)
    ).toBeVisible({ timeout: 15_000 });
  }
}
