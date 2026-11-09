import { expect, test } from '@playwright/test';

const intro = '/docs/angular/ag-ui/getting-started/introduction';
const interrupts = '/docs/angular/ag-ui/guides/interrupts';

for (const width of [375, 1440]) {
  test(`Run fallback filters examples and API uses generated declarations at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${intro}?mode=run`);
    const shell = page.locator('[data-workspace-shell]');
    await expect(shell).toHaveAttribute('data-hydrated', 'true');
    await expect(shell).toHaveAttribute('data-workspace-mode', 'Run');
    await expect(
      page.getByRole('heading', { name: 'See it in action.' })
    ).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
    const directory = page.locator('.docs-examples');
    await expect(
      directory.getByRole('button', { name: 'Framework', exact: true })
    ).toHaveText('Angular');
    await directory
      .getByRole('button', { name: 'Library', exact: true })
      .click();
    await directory
      .getByRole('menuitemradio', { name: 'AG-UI', exact: true })
      .click();
    await directory.getByLabel('Find an example').fill('interrupts');
    await expect(directory.locator('.docs-example-card')).toHaveCount(1);
    await expect(directory.locator('.docs-example-card')).toHaveAttribute(
      'href',
      `${interrupts}?mode=run`
    );
    await directory.getByLabel('Find an example').fill('no-example-exists');
    await expect(directory.getByText('No examples match.')).toBeVisible();
    await directory.getByRole('button', { name: 'Show all examples' }).click();
    await expect(
      directory.getByRole('button', { name: 'Framework', exact: true })
    ).toHaveText('All frameworks');
    await page.locator('[data-workspace-toolbar-mode="API"]').click();
    await expect(
      page.getByRole('heading', { name: 'API reference', exact: true })
    ).toBeVisible();
    await expect(
      page
        .locator('.api-reference-page')
        .getByRole('link', { name: 'injectAgent', exact: true })
    ).toHaveAttribute('href', '/docs/api/ag-ui/injectAgent');
    await page.reload();
    await expect(shell).toHaveAttribute('data-workspace-mode', 'API');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBe(width);
  });
}

test('matching example retains its iframe while API replaces the demo-derived reference', async ({
  page,
}) => {
  await page.goto(`${interrupts}?mode=run`);
  const shell = page.locator('[data-workspace-shell]');
  await expect(shell).toHaveAttribute('data-hydrated', 'true');
  const frame = page.locator('iframe');
  await expect(frame).toHaveCount(1);
  await frame.evaluate((element) =>
    element.setAttribute('data-test-persistent', 'yes')
  );
  await page.locator('[data-workspace-toolbar-mode="API"]').click();
  await expect(
    page
      .locator('.api-reference-page')
      .getByRole('link', { name: 'injectAgent', exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('InterruptsComponent', { exact: true })
  ).toHaveCount(0);
  await expect(frame).toHaveAttribute('data-test-persistent', 'yes');
  await page.goBack();
  await expect(shell).toHaveAttribute('data-workspace-mode', 'Run');
  await expect(frame).toHaveAttribute('data-test-persistent', 'yes');
});

test('generated API links start in API mode and explicit Docs survives reload and history', async ({
  page,
}) => {
  await page.goto('/docs/api/ag-ui/injectAgent');
  const shell = page.locator('[data-workspace-shell]');
  await expect(shell).toHaveAttribute('data-workspace-mode', 'API');
  await expect(page.locator('.api-reference-page h1')).toHaveText(
    'injectAgent'
  );
  await page.locator('[data-workspace-toolbar-mode="Docs"]').click();
  await expect(page).toHaveURL(/\?mode=docs$/);
  await page.reload();
  await expect(shell).toHaveAttribute('data-workspace-mode', 'Docs');
  await page.locator('[data-workspace-toolbar-mode="API"]').click();
  await expect(page).toHaveURL(/\/docs\/api\/ag-ui\/injectAgent$/);
  await page.goBack();
  await expect(shell).toHaveAttribute('data-workspace-mode', 'Docs');
  await page.goForward();
  await expect(shell).toHaveAttribute('data-workspace-mode', 'API');
  await page.locator('[data-workspace-toolbar-mode="Run"]').click();
  await expect(
    page.getByRole('heading', { name: 'See it in action.' })
  ).toBeVisible();
});

test('generated member fragments survive a direct load in API mode', async ({
  page,
}) => {
  await page.goto('/docs/api/ag-ui/AgUiAgent');
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-workspace-mode',
    'API'
  );
  const member = page.locator('.api-reference-declaration[id]').last();
  const id = await member.getAttribute('id');
  expect(id).toBeTruthy();
  await page.goto(`/docs/api/ag-ui/AgUiAgent#${id}`);
  await page.reload();
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-hydrated',
    'true'
  );
  await expect(member).toBeInViewport();
});

test('standalone directory starts in Run and links to runnable examples', async ({
  page,
}) => {
  await page.goto('/docs/examples');
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-workspace-mode',
    'Run'
  );
  const directory = page.locator('.docs-examples');
  await directory
    .getByRole('button', { name: 'Framework', exact: true })
    .click();
  await directory
    .getByRole('menuitemradio', { name: 'Angular', exact: true })
    .click();
  await directory.getByRole('button', { name: 'Library', exact: true }).click();
  await directory
    .getByRole('menuitemradio', { name: 'AG-UI', exact: true })
    .click();
  await directory.getByLabel('Find an example').fill('interrupts');
  await directory.locator('.docs-example-card').click();
  await expect(page).toHaveURL(new RegExp(`${interrupts}\\?mode=run$`));
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-workspace-mode',
    'Run'
  );
});

for (const [route, framework] of [
  ['/docs/api/ag-ui/injectAgent', 'angular'],
  ['/docs/api/react/useAgent', 'react'],
] as const) {
  test(`Run from ${framework} API keeps its framework filter`, async ({
    page,
  }) => {
    await page.goto(`${route}?mode=run`);
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
      'data-hydrated',
      'true'
    );
    await expect(
      page
        .locator('.docs-examples')
        .getByRole('button', { name: 'Framework', exact: true })
    ).toHaveText(framework === 'angular' ? 'Angular' : 'React');
  });
}
