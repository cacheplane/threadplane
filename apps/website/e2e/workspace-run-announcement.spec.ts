import { expect, test, type Page } from '@playwright/test';

const toast = (page: Page) => page.locator('[data-announcement-toast]');
const region = (page: Page) => page.locator('[data-announcement-region]');
const shell = (page: Page) => page.locator('[data-workspace-shell]');
const violations = new WeakMap<Page, string[]>();

test.skip(
  ({ baseURL }) =>
    !baseURL || !['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname),
  'Requires owned local static native previews; never run against a deployed Website.'
);

async function mode(page: Page, name: 'Docs' | 'Code' | 'API' | 'Run') {
  const mobile = (page.viewportSize()?.width ?? 1280) < 768;
  if (mobile)
    await page.getByRole('button', { name: 'Open navigation' }).click();
  const navigation = mobile
    ? page.getByRole('dialog', { name: 'Documentation control plane' })
    : page.locator('[data-workspace-desktop-navigation]');
  await navigation
    .getByRole('button', {
      name: name === 'Run' ? /^Run(?:,|$)/ : name,
      exact: name !== 'Run',
    })
    .click();
  await expect(shell(page)).toHaveAttribute('data-workspace-mode', name);
  if (mobile) await expect(navigation).toHaveCount(0);
}

// Workspace locks document scrolling. Exercise the real scroll listener with a
// temporary inert layout fixture, then restore geometry before any UI assertion.
async function eligible(page: Page, expectMounted = true) {
  const original = await page.evaluate(() => {
    const html = document.documentElement;
    const body = document.body;
    const saved = {
      html: html.getAttribute('style'),
      body: body.getAttribute('style'),
      x: scrollX,
      y: scrollY,
      height: html.scrollHeight,
      width: html.scrollWidth,
    };
    html.style.setProperty('overflow', 'auto', 'important');
    html.style.setProperty('height', 'auto', 'important');
    body.style.setProperty('overflow', 'visible', 'important');
    body.style.setProperty('height', 'auto', 'important');
    const spacer = document.createElement('div');
    spacer.id = 'announcement-scroll-fixture';
    spacer.inert = true;
    spacer.style.height = `${innerHeight * 4}px`;
    body.append(spacer);
    const range = html.scrollHeight - innerHeight;
    window.scrollTo(0, range * 0.5);
    return { ...saved, range };
  });
  expect(original.range).toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.evaluate(
        () => scrollY / (document.documentElement.scrollHeight - innerHeight)
      )
    )
    .toBeGreaterThanOrEqual(0.4);
  await page.clock.runFor(100);
  await page.clock.fastForward(30_100);
  await page.clock.runFor(100);
  if (expectMounted)
    await expect(toast(page)).toHaveAttribute('data-mounted', 'true');
  await page.evaluate((saved) => {
    document.getElementById('announcement-scroll-fixture')?.remove();
    for (const [element, value] of [
      [document.documentElement, saved.html],
      [document.body, saved.body],
    ] as const) {
      if (value === null) element.removeAttribute('style');
      else element.setAttribute('style', value);
    }
    window.scrollTo({ left: saved.x, top: saved.y, behavior: 'instant' });
  }, original);
  await page.clock.runFor(300);
  const restored = await page.evaluate((saved) => {
    window.scrollTo({ left: saved.x, top: saved.y, behavior: 'instant' });
    for (const [element, value] of [
      [document.documentElement, saved.html],
      [document.body, saved.body],
    ] as const) {
      element.style.cssText = value ?? '';
      // Flush Chromium's lazy CSSOM attribute serialization before removing
      // an originally absent style attribute.
      element.getAttribute('style');
      if (value === null) element.removeAttribute('style');
      else element.setAttribute('style', value);
    }
    return {
      html: document.documentElement.getAttribute('style'),
      body: document.body.getAttribute('style'),
      x: scrollX,
      y: scrollY,
      height: document.documentElement.scrollHeight,
      width: document.documentElement.scrollWidth,
    };
  }, original);
  expect(restored).toEqual({
    html: original.html,
    body: original.body,
    x: original.x,
    y: original.y,
    height: original.height,
    width: original.width,
  });
  await expect(page.locator('#announcement-scroll-fixture')).toHaveCount(0);
  await expect(shell(page)).toHaveAttribute('data-hydrated', 'true');
}

async function hidden(page: Page) {
  await expect(toast(page)).toHaveCount(1);
  await expect(region(page)).toBeHidden();
  await expect(toast(page)).toBeHidden();
  expect(
    await region(page).evaluate((element) => getComputedStyle(element).display)
  ).toBe('none');
  await expect(
    page.getByRole('dialog', { name: 'From Prototype to Production' })
  ).toHaveCount(0);
  expect(await region(page).ariaSnapshot()).toBe('');
  expect(
    await region(page).evaluate((element) => element.getClientRects().length)
  ).toBe(0);
  await toast(page)
    .getByRole('button', { name: 'Dismiss', exact: true, includeHidden: true })
    .evaluate((element) => (element as HTMLElement).focus());
  expect(
    await page.evaluate(
      () => !!document.activeElement?.closest('[data-announcement-region]')
    )
  ).toBe(false);
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest('[data-announcement-region]')
      )
    ).toBe(false);
  }
}

test.beforeEach(async ({ page, context }) => {
  // No public transport or authoring: previews are local static builds/fixtures.
  const unexpected: string[] = [];
  violations.set(page, unexpected);
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !['GET', 'HEAD'].includes(request.method())
    ) {
      if (
        !['GET', 'HEAD'].includes(request.method()) ||
        /\/threads(?:\/|$)|\/api\/native(?:\/|$)|\/agent(?:\/|$)/.test(
          url.pathname
        )
      ) {
        unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
      }
      await route.abort();
    } else await route.continue();
  });
  await page.clock.install();
});
test.afterEach(async ({ page }) => {
  expect(violations.get(page)).toEqual([]);
});

for (const frontend of ['angular', 'react'] as const) {
  const path =
    frontend === 'angular'
      ? '/docs/langgraph/guides/streaming'
      : '/docs/deep-agents/capabilities/filesystem';
  for (const width of [1280, 390]) {
    for (const direct of [false, true]) {
      test(`${frontend} ${width} ${
        direct ? 'direct Run with late eligibility' : 'eligible Docs then Run'
      } preserves native draft and history`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(
          `${path}?frontend=${frontend}${direct ? '&mode=run' : ''}`
        );
        await expect(shell(page)).toHaveAttribute('data-hydrated', 'true');
        await expect(shell(page)).toHaveAttribute(
          'data-workspace-mode',
          direct ? 'Run' : 'Docs'
        );
        await eligible(page);
        if (!direct) {
          await expect(toast(page)).toBeVisible();
          await mode(page, 'Run');
        }
        await hidden(page);
        const iframe = page.locator('iframe');
        await expect(iframe).toBeVisible();
        await expect(iframe).toHaveAttribute(
          'src',
          frontend === 'angular' ? /localhost:4300/ : /localhost:4629/
        );
        const identity = await iframe.elementHandle();
        const input = page.frameLocator('iframe').getByRole('textbox').first();
        await expect(input).toBeVisible();
        await input.click();
        await input.fill('Unsent announcement regression draft');
        await expect(input).toHaveValue('Unsent announcement regression draft');
        expect(
          await input.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return element.contains(
              document.elementFromPoint(
                rect.x + rect.width / 2,
                rect.y + rect.height / 2
              )
            );
          })
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath('run-announcement-hidden.png'),
        });
        if (width === 390) {
          await page.getByRole('button', { name: 'Open navigation' }).click();
          await expect(region(page)).toHaveAttribute(
            'data-workspace-modal-hidden',
            ''
          );
          await expect
            .poll(() =>
              page.evaluate(() =>
                document.activeElement
                  ?.closest('[role="dialog"]')
                  ?.getAttribute('aria-label')
              )
            )
            .toBe('Documentation control plane');
          await page.keyboard.press('Escape');
          await expect(
            page.getByRole('dialog', { name: 'Documentation control plane' })
          ).toHaveCount(0);
          await expect(region(page)).not.toHaveAttribute(
            'data-workspace-modal-hidden',
            ''
          );
          await hidden(page);
        }
        await mode(page, 'Code');
        await expect(toast(page)).toBeVisible();
        await page.goBack();
        await expect(shell(page)).toHaveAttribute('data-workspace-mode', 'Run');
        await hidden(page);
        await expect(input).toHaveValue('Unsent announcement regression draft');
        expect(
          await iframe.evaluate(
            (element, original) => element === original,
            identity
          )
        ).toBe(true);
        await page.goForward();
        await expect(shell(page)).toHaveAttribute(
          'data-workspace-mode',
          'Code'
        );
        await expect(toast(page)).toBeVisible();
        for (const next of ['API', 'Docs'] as const) {
          await mode(page, next);
          await expect(toast(page)).toBeVisible();
        }
        if (width === 390) {
          await page.getByRole('button', { name: 'Open navigation' }).click();
          await expect(toast(page)).toBeHidden();
          await expect
            .poll(() =>
              page.evaluate(() =>
                document.activeElement
                  ?.closest('[role="dialog"]')
                  ?.getAttribute('aria-label')
              )
            )
            .toBe('Documentation control plane');
          await page.keyboard.press('Escape');
          await expect(
            page.getByRole('dialog', { name: 'Documentation control plane' })
          ).toHaveCount(0);
          await expect(toast(page)).toBeVisible();
        }
        await toast(page)
          .getByRole('button', { name: 'Dismiss', exact: true })
          .click();
        await mode(page, 'Run');
        await mode(page, 'Docs');
        await expect(toast(page)).toHaveCount(0);
        await page.reload();
        await expect(shell(page)).toHaveAttribute('data-hydrated', 'true');
        await eligible(page, false);
        await expect(toast(page)).toHaveCount(0);
      });
    }
  }
}

for (const path of [
  '/docs/langgraph/getting-started/introduction?mode=run',
  '/docs/langgraph/guides/streaming?mode=invalid',
]) {
  test(`rendered Docs stays eligible at ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(shell(page)).toHaveAttribute('data-hydrated', 'true');
    await expect(shell(page)).toHaveAttribute('data-workspace-mode', 'Docs');
    await eligible(page);
    await expect(toast(page)).toBeVisible();
  });
}

test('normal marketing page keeps natural timer and scroll eligibility', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('main')).toBeVisible();
  await page.clock.fastForward(31_000);
  await expect(toast(page)).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight - innerHeight
    )
  ).toBeGreaterThan(0);
  await page.evaluate(() =>
    window.scrollTo(
      0,
      (document.documentElement.scrollHeight - innerHeight) * 0.5
    )
  );
  await page.clock.runFor(500);
  await expect(toast(page)).toBeVisible();
  await expect(toast(page)).toHaveAttribute('data-mounted', 'true');
});
