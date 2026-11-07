import { selectFramework, expectFrameworkControl } from './fixtures/framework-controls';
import { test, expect, type Page } from '@playwright/test';
import { fromPageOrReactPreview } from './fixtures/react-preview-requests';
const route = '/docs/angular/chat/concepts/message-model';
const reactRoute = '/docs/react/chat/concepts/message-model';
const reactFrame = /(?:localhost:4620|chat\/messages\/react)/;
declare global {
  interface Window {
    __parentViewportProof?: { loads: number; configured: number };
  }
}

for (const framework of ['angular', 'react']) {
  test(`${framework} parent viewport resizes the existing cross-origin frame above the keyboard`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 402, height: 714 });
    await page.addInitScript(() => {
      window.__parentViewportProof = { loads: 0, configured: 0 };
      document.addEventListener(
        'load',
        (event) => {
          if (event.target instanceof HTMLIFrameElement)
            window.__parentViewportProof!.loads++;
        },
        true
      );
      window.addEventListener('message', (event) => {
        if (event.data?.type === 'tplane:runtime-configured')
          window.__parentViewportProof!.configured++;
      });
    });
    await page.goto(`/docs/${framework}/chat/concepts/message-model?mode=run`);
    await hydrated(page, 'run');
    const frame = page.locator('iframe');
    const input = page.frameLocator('iframe').getByRole('textbox');
    await expect(input).toBeEditable();
    await expect
      .poll(() =>
        page.evaluate(() => window.__parentViewportProof?.configured ?? 0)
      )
      .toBeGreaterThan(0);
    const node = await frame.elementHandle();
    const source = await frame.getAttribute('src');
    const before = await page.evaluate(() => ({
      ...window.__parentViewportProof!,
    }));
    const draft = 'A mobile draft with several wrapped lines. '.repeat(6);
    await input.fill(draft);
    await input.focus();
    await page.evaluate(() => {
      // Keep the layout viewport at 714: only the parent visual viewport changes.
      Object.defineProperty(visualViewport!, 'height', {
        configurable: true,
        value: 377,
      });
      visualViewport!.dispatchEvent(new Event('resize'));
    });
    await expect
      .poll(async () => (await frame.boundingBox())?.height ?? 714)
      .toBeLessThan(377);
    const geometry = await frame.boundingBox();
    expect(geometry).not.toBeNull();
    expect(geometry!.y + geometry!.height).toBeLessThanOrEqual(377);
    expect(await page.evaluate(() => innerHeight)).toBe(714);
    await expect
      .poll(() => input.evaluate(() => innerHeight))
      .toBeCloseTo(geometry!.height, 0);
    const caret = await input.boundingBox();
    expect(caret).not.toBeNull();
    expect(caret!.y).toBeGreaterThanOrEqual(geometry!.y);
    expect(caret!.y + caret!.height).toBeLessThanOrEqual(377);
    const footer = page
      .frameLocator('iframe')
      .locator(framework === 'react' ? '.tp-example__footer' : '.input-strip');
    const footerBox = await footer.boundingBox();
    expect(footerBox).not.toBeNull();
    expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(377);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(draft);
    const nav = await page.locator('[data-site-navigation]').boundingBox();
    expect(nav?.y).toBe(0);
    await page.evaluate(() => {
      Object.defineProperty(visualViewport!, 'height', {
        configurable: true,
        value: 714,
      });
      visualViewport!.dispatchEvent(new Event('resize'));
    });
    await expect
      .poll(async () => (await frame.boundingBox())?.height ?? 0)
      .toBeGreaterThan(377);
    expect(await node!.evaluate((element) => element.isConnected)).toBe(true);
    await expect(frame).toHaveAttribute('src', source!);
    await expect(input).toHaveValue(draft);
    expect(await page.evaluate(() => window.__parentViewportProof)).toEqual(
      before
    );
  });
}
const observations = new WeakMap<
  Page,
  { requests: string[]; errors: string[] }
>();
test.beforeEach(async ({ page }) => {
  const observed = { requests: [] as string[], errors: [] as string[] };
  observations.set(page, observed);
  page.on('request', (request) => {
    if (
      /\/threads(?:\/|$)/.test(new URL(request.url()).pathname) &&
      fromPageOrReactPreview(request, reactFrame)
    )
      observed.requests.push(request.method());
  });
  page.on('pageerror', (error) => observed.errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(observations.get(page)?.requests).toEqual([]);
  expect(observations.get(page)?.errors).toEqual([]);
});
async function hydrated(page: Page, mode: 'docs' | 'code' | 'run') {
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-hydrated',
    'true'
  );
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-workspace-mode',
    { docs: 'Docs', code: 'Code', run: 'Run' }[mode]
  );
}
async function emptyRun(page: Page, draft = '') {
  await hydrated(page, 'run');
  await expect(page.getByLabel('Framework')).toHaveValue('react');
  await expect(page).toHaveURL(/(?:\?|&)mode=run(?:&|$)/);
  await expect(page.locator('iframe')).toBeVisible();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    reactFrame
  );
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('status')).toHaveText('Ready.');
  await expect(
    frame
      .getByRole('region', { name: 'Conversation', exact: true })
      .locator('article')
  ).toHaveCount(0);
  await expect(frame.getByLabel('Message', { exact: true })).toHaveValue(draft);
}
test('native Chat Messages keeps canonical Docs, Code and Run aligned', async ({
  page,
}, testInfo) => {
  await page.goto(reactRoute, { waitUntil: 'domcontentloaded' });
  await hydrated(page, 'docs');
  await expect(page.getByLabel('Framework')).toHaveValue('react');
  await expect(
    page.getByRole('heading', {
      name: 'React chat messages preview',
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.locator(
      '[data-example-file="cockpit/chat/messages/react/src/application.ts"]'
    )
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('react-chat-messages-docs-desktop.png'),
  });
  await page
    .locator('[data-workspace-desktop-navigation]')
    .getByRole('button', { name: 'Code', exact: true })
    .click();
  await hydrated(page, 'code');
  await expect(page).toHaveURL(/(?:\?|&)mode=code(?:&|$)/);
  await page
    .locator('[data-workspace-desktop-navigation]')
    .getByRole('button', { name: /^Run(?:,|$)/ })
    .click();
  await emptyRun(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectFrameworkControl(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('react-chat-messages-run-mobile.png'),
  });
});
test('the canonical message concept keeps Angular as its default frontend', async ({
  page,
}) => {
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await hydrated(page, 'docs');
  await expect(page.getByLabel('Framework')).toHaveValue('angular');
  await expect(
    page.getByRole('heading', {
      name: 'React chat messages preview',
      exact: true,
    })
  ).toHaveCount(0);
  await selectFramework(page, 'react');
  await expect(
    page.getByRole('heading', {
      name: 'React chat messages preview',
      exact: true,
    })
  ).toBeVisible();
  await expect(page).toHaveURL(/\/docs\/react\//);
});
test('a direct React run link mounts an empty conversation without creating a thread', async ({
  page,
}) => {
  await page.goto(reactRoute + '?mode=run', {
    waitUntil: 'domcontentloaded',
  });
  await emptyRun(page);
});
test('history preserves the mounted React owner and unsent draft without runtime requests', async ({
  page,
}) => {
  await page.goto(reactRoute + '?mode=run', {
    waitUntil: 'domcontentloaded',
  });
  await emptyRun(page);
  const mountedFrame = await page.locator('iframe').elementHandle();
  await page
    .frameLocator('iframe')
    .getByLabel('Message', { exact: true })
    .fill('Unsent history draft');
  await expect(
    page.frameLocator('iframe').getByLabel('Message', { exact: true })
  ).toHaveValue('Unsent history draft');
  const before = [...(observations.get(page)?.requests ?? [])];
  await page
    .locator('[data-workspace-desktop-navigation]')
    .getByRole('button', { name: 'Code', exact: true })
    .click();
  await hydrated(page, 'code');
  await expect(page).toHaveURL(/(?:\?|&)mode=code(?:&|$)/);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await emptyRun(page, 'Unsent history draft');
  expect(
    await page
      .locator('iframe')
      .evaluate((frame, original) => frame === original, mountedFrame)
  ).toBe(true);
  expect(observations.get(page)?.requests).toEqual(before);
});
test('reload clears an unsent React draft without runtime requests', async ({
  page,
}) => {
  await page.goto(reactRoute + '?mode=run', {
    waitUntil: 'domcontentloaded',
  });
  await emptyRun(page);
  const before = [...(observations.get(page)?.requests ?? [])];
  await page
    .frameLocator('iframe')
    .getByLabel('Message', { exact: true })
    .fill('Unsent reload draft');
  await expect(
    page.frameLocator('iframe').getByLabel('Message', { exact: true })
  ).toHaveValue('Unsent reload draft');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await emptyRun(page);
  expect(observations.get(page)?.requests).toEqual(before);
});
