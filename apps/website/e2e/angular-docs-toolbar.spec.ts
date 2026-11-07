import { expect, test } from '@playwright/test';

const route = '/docs/angular/ag-ui/guides/interrupts';

for (const width of [320, 375, 768, 1440]) {
  test(`Angular reading toolbar preserves modes and utility focus at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(route);
    const shell = page.locator('[data-workspace-shell]');
    await expect(shell).toHaveAttribute('data-hydrated', 'true');
    await expect(shell).toHaveAttribute(
      'data-workspace-navigation-layout',
      'toolbar'
    );
    await expect(shell.locator('[data-control-plane-rail]')).toHaveCount(0);
    const modes = page.getByRole('navigation', {
      name: 'Documentation modes',
      exact: true,
    });
    await expect(modes).toBeVisible();
    for (const button of await modes.getByRole('button').all()) {
      if (width < 768)
        expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    await modes.getByRole('button', { name: 'Code', exact: true }).click();
    await expect(shell).toHaveAttribute('data-workspace-mode', 'Code');
    await expect(page).toHaveURL(/mode=code/);
    if (width >= 1024)
      await expect(
        page.getByRole('button', { name: 'Search docs', exact: true })
      ).toBeVisible();
    await modes.getByRole('button', { name: 'Docs', exact: true }).click();
    await expect(page.locator('.docs-prose h1')).toHaveText('Interrupts');
    await page.goBack();
    await expect(shell).toHaveAttribute('data-workspace-mode', 'Code');
    await page.goForward();
    await expect(shell).toHaveAttribute('data-workspace-mode', 'Docs');

    const tools = page.getByRole('button', {
      name: 'Workspace tools',
      exact: true,
    });
    await tools.click();
    await expect(
      page.getByRole('menuitem', { name: /^Activity/ })
    ).toBeFocused();
    await page.keyboard.press('End');
    await expect(
      page.getByRole('menuitem', { name: 'Settings', exact: true })
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { name: 'Settings', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Recheck', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Reload runtime', exact: true })
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Close Settings', exact: true })
      .click();
    if (width < 768) {
      await expect(
        page.getByRole('button', { name: 'Search docs', exact: true })
      ).toBeFocused();
      await page
        .getByRole('button', { name: 'Close navigation', exact: true })
        .click();
    }
    if (width < 1024)
      await expect(page.locator('.workspace-mobile-control-plane')).toHaveCount(
        0
      );
    await expect(tools).toBeFocused();
    await tools.click();
    await page.getByRole('menuitem', { name: /^Activity/ }).click();
    await expect(
      page.getByRole('heading', { name: 'Activity', exact: true })
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Close Activity', exact: true })
      .click();
    if (width < 768)
      await page
        .getByRole('button', { name: 'Close navigation', exact: true })
        .click();
    await expect(tools).toBeFocused();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBe(width);
  });
}

test('Angular docs-only Run opens the example directory', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/docs/angular/ag-ui/getting-started/introduction');
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-hydrated',
    'true'
  );
  const run = page.locator('[data-workspace-toolbar-mode="Run"]');
  await expect(run).not.toHaveAttribute('aria-disabled', 'true');
  await run.press('Enter');
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-workspace-mode',
    'Run'
  );
  await expect(page.getByRole('heading', { name: 'See it in action.' })).toBeVisible();
});

for (const width of [375, 1440]) {
  test(`Angular approval diagram remains readable and restores focus at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(route);
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-hydrated', 'true');
    const diagram = page
      .locator('[data-docs-diagram]')
      .filter({ has: page.locator('.tp-human-approval-flow') });
    const flow = page.locator('.tp-human-approval-flow');
    await expect(flow).toBeVisible();
    const nodes = flow.locator('.tp-human-approval-node');
    await expect(nodes).toHaveCount(3);
    const first = await nodes.nth(0).boundingBox();
    const last = await nodes.nth(2).boundingBox();
    if (width < 768) expect(last?.y).toBeGreaterThan(first?.y ?? 0);
    else expect(last?.y).toBe(first?.y);
    expect(await flow.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true
    );
    const expand = diagram.getByRole('button', { name: /^Expand diagram:/ });
    await expand.click();
    const dialog = page.getByRole('dialog', {
      name: 'The human approval flow',
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(flow).toHaveCount(1);
    await expect(dialog.locator('.tp-diagram-dialog-header')).toHaveCSS(
      'position',
      'sticky'
    );
    await dialog.getByText('Read diagram description', { exact: true }).click();
    await expect(dialog.locator('.tp-diagram-description p')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(expand).toBeFocused();
    await expect(flow).toHaveCount(1);
  });
}
