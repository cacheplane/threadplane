import { test, expect } from '@playwright/test';

/**
 * `<ExampleCode>` renders a docs page's example file through the docs code
 * pipeline. jsdom proves the element tree; only a browser proves that the
 * fence was highlighted, that the title bar is visible, and that the copy
 * button copies the example source rather than the title or the markers.
 */
test.describe('ExampleCode on a docs page', () => {
  const route = '/docs/langgraph/guides/streaming';
  const file =
    'cockpit/langgraph/streaming/angular/src/app/streaming.component.ts';

  test('renders a highlighted, titled, copyable block from the example file', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(route);

    const block = page
      .locator(`.mdx-example-code[data-example-file="${file}"]`)
      .first();
    await expect(block).toBeVisible();
    await expect(block.locator('.mdx-example-code-title')).toHaveText(
      'streaming.component.ts'
    );
    await expect(block).toHaveAttribute('role', 'group');

    // Highlighted: shiki emits per-token spans with inline colour.
    //
    // rehype-pretty-code is configured with a single theme (tokyo-night, see
    // mdx-options.ts), which emits inline `color:` per token. A light/dark
    // theme pair would switch to `--shiki-*` custom properties instead, and
    // this count would then need `span[style*="--shiki"]`.
    const pre = block.locator('pre').first();
    await expect(pre).toBeVisible();
    expect(await pre.locator('span[style*="color"]').count()).toBeGreaterThan(
      10
    );
    await expect(pre).toContainText('export class StreamingComponent');

    // Copy after hydration, then read only once the button acknowledges it.
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
      'data-hydrated',
      'true'
    );
    await block.locator('button[aria-label="Copy code"]').click();
    await expect(
      block.getByRole('button', { name: 'Copied', exact: true })
    ).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('export class StreamingComponent');
    expect(copied).toBe(await pre.textContent());
  });
});
