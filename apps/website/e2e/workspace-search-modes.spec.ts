import { expect, test } from '@playwright/test';

const cases = [
  { route: '/docs/angular/ag-ui/guides/interrupts?mode=api', mode: 'API' },
  { route: '/docs/angular/ag-ui/guides/interrupts?mode=code', mode: 'Code' },
  {
    route: '/docs/angular/ag-ui/getting-started/introduction?mode=run',
    mode: 'Run',
  },
  { route: '/docs/api/react/useAgent?mode=run', mode: 'Run' },
  { route: '/docs/examples', mode: 'Run' },
] as const;

for (const width of [375, 1440]) {
  for (const { route, mode } of cases) {
    test(`workspace search works from ${route} at ${width}px`, async ({
      page,
    }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route, { timeout: 30_000 });
      await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
        'data-workspace-mode',
        mode,
        { timeout: 15_000 }
      );
      if (width < 768)
        await page
          .getByRole('button', { name: 'Open navigation', exact: true })
          .click();
      await page
        .getByRole('button', { name: 'Search docs', exact: true })
        .click();
      const dialog = page.getByRole('dialog', {
        name: 'Search documentation',
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveCount(1);
      await expect(dialog.getByRole('combobox')).toBeFocused();
      await expect(page.locator('.workspace-mobile-control-plane')).toHaveCount(
        0
      );
      if (route.startsWith('/docs/angular/ag-ui/')) {
        const scopes = await dialog
          .locator('.docs-search-result-lib')
          .allTextContents();
        expect(scopes.length).toBeGreaterThan(0);
        expect(
          scopes.every((scope) =>
            [
              'Start here',
              'Getting started · Angular',
              'Getting started · Shared',
              'AG-UI · Angular',
            ].includes(scope)
          )
        ).toBe(true);
      }
      if (route.startsWith('/docs/api/react/')) {
        const scopes = await dialog
          .locator('.docs-search-result-lib')
          .allTextContents();
        expect(scopes.some((scope) => scope.includes('React'))).toBe(true);
        expect(scopes.some((scope) => scope.includes('Angular'))).toBe(false);
      }
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await page.locator('[data-workspace-toolbar-mode="Docs"]').click();
      await page.keyboard.press('ControlOrMeta+k');
      await expect(dialog).toHaveCount(1);
      await expect(dialog).toBeVisible();
      await page.keyboard.press('ControlOrMeta+k');
      await expect(dialog).toHaveCount(0);
    });
  }
}
