import { test, expect } from '@playwright/test';

for (const frontend of ['angular', 'react'] as const) {
  test(`Render Spec ${frontend} Docs keeps highlighted source copyable through hydration and reload`, async ({
    page,
    context,
  }) => {
    const errors: string[] = [];
    const executions: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (
        !['GET', 'HEAD'].includes(request.method()) &&
        /\/agent(?:\/|$)|\/api\/native(?:\/|$)|\/api\/threads(?:\/|$)|\/threads(?:\/|$)/.test(
          new URL(request.url()).pathname
        )
      )
        executions.push(request.url());
    });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const query = frontend === 'react' ? '?frontend=react' : '';
    await page.goto('/docs/render/guides/specs' + query, {
      waitUntil: 'domcontentloaded',
    });
    for (const reload of [false, true]) {
      if (reload) await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
        'data-hydrated',
        'true'
      );
      await expect(page.getByLabel('Example UI')).toHaveValue(frontend);
      const path =
        frontend === 'react'
          ? 'cockpit/render/spec-rendering/react/src/playback.ts'
          : 'cockpit/render/spec-rendering/angular/src/app/app.config.ts';
      const block = page.locator(`[data-example-file="${path}"]`);
      await expect(block).toBeVisible();
      await expect(block.locator('pre > code')).toHaveCount(1);
      const source = await block.locator('pre').textContent();
      expect(source?.length).toBeGreaterThan(0);
      await block
        .getByRole('button', { name: 'Copy code', exact: true })
        .click();
      await expect(
        block.getByRole('button', { name: 'Copied', exact: true })
      ).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        source
      );
      expect(errors).toEqual([]);
      expect(executions).toEqual([]);
    }
  });
}
